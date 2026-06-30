/**
 * Production Lock Helpers — Real PostgreSQL Integration Tests
 *
 * Tier: 生产函数 + PrismaClient + 真实PostgreSQL集成测试
 *
 * Calls the actual production acquireTestEnvLock / releaseTestEnvLock
 * through two independent PrismaClient instances to verify:
 *   - Database-level mutual exclusion for empty / expired / valid locks
 *   - Cross-generational release safety (triplet compare-and-delete)
 *
 * Requires KERNEL_TEST_DATABASE_URL to point to a local PostgreSQL
 * database.  When unset the entire describe block is skipped.
 *
 * NO_PRODUCTION_DATABASE_ACCESSED
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { acquireTestEnvLock, releaseTestEnvLock } from '../routes/requirements/workflow-advance-helpers.js';
import { HttpError } from '../utils/http-error.js';

// ── Configuration ────────────────────────────────────────────────

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;
const integration = PG_URL ? describe : describe.skip;
const INTEGRATION_TIMEOUT = 30000;
const TTL_MS = 4 * 60 * 60 * 1000;

// UUIDs for test requirements (matching UUID format)
const UUID_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const OLD_TOKEN = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
const FRESH_TOKEN = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const WRONG_TOKEN = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

// ═════════════════════════════════════════════════════════════════
//  PRODUCTION FUNCTION TESTS
// ═════════════════════════════════════════════════════════════════

integration('production acquireTestEnvLock via PrismaClient', () => {
  let clientA: PrismaClient;
  let clientB: PrismaClient;

  beforeAll(async () => {
    clientA = new PrismaClient({ datasourceUrl: PG_URL });
    clientB = new PrismaClient({ datasourceUrl: PG_URL });
    await clientA.$connect();
    await clientB.$connect();
    await clientA.testEnvLock.deleteMany({ where: { id: 'singleton' } });
  });

  beforeEach(async () => {
    await clientA.testEnvLock.deleteMany({ where: { id: 'singleton' } });
  });

  afterAll(async () => {
    await clientA.testEnvLock.deleteMany({ where: { id: 'singleton' } });
    await clientA.$disconnect();
    await clientB.$disconnect();
  });

  // ── Scenario 1: Empty lock concurrent contention ────────────

  it('1. empty lock — exactly one succeeds, one gets 409', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const [r1, r2] = await Promise.allSettled([
      acquireTestEnvLock(UUID_A, 'req-a', null, { db: clientA }),
      acquireTestEnvLock(UUID_B, 'req-b', null, { db: clientB }),
    ]);

    const successes = [r1, r2].filter(r => r.status === 'fulfilled').length;
    expect(successes).toBe(1);

    // Exactly one rejection with 409
    const rejected = [r1, r2].filter(r => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(HttpError);
      expect((rejected[0].reason as HttpError).statusCode).toBe(409);
    }

    // Database has exactly one lock
    const lock = await clientA.testEnvLock.findUnique({ where: { id: 'singleton' } });
    expect(lock).not.toBeNull();
    expect(lock!.lockToken).toBeTruthy();

    // The lock's requirementId belongs to the winner
    const winner = r1.status === 'fulfilled' ? r1.value : (r2.status === 'fulfilled' ? r2.value : null);
    expect(winner).not.toBeNull();
    expect(lock!.requirementId).toBe(winner!.acquiredForRequirement);
    expect(lock!.lockToken).toBe(winner!.lockToken);
  });

  // ── Scenario 2: Expired lock concurrent takeover ────────────

  it('2. expired lock — exactly one takes over, one gets 409', { timeout: INTEGRATION_TIMEOUT }, async () => {
    // Pre-seed an expired lock (older than TTL)
    const oldDate = new Date(Date.now() - TTL_MS - 120_000);
    await clientA.testEnvLock.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', requirementId: UUID_C, requirementTitle: 'old', acquiredAt: oldDate, lockToken: OLD_TOKEN },
      update: { requirementId: UUID_C, requirementTitle: 'old', acquiredAt: oldDate, lockToken: OLD_TOKEN },
    });

    const [r1, r2] = await Promise.allSettled([
      acquireTestEnvLock(UUID_A, 'req-a', null, { db: clientA, now: new Date() }),
      acquireTestEnvLock(UUID_B, 'req-b', null, { db: clientB, now: new Date() }),
    ]);

    const successes = [r1, r2].filter(r => r.status === 'fulfilled').length;
    expect(successes).toBe(1);

    const rejected = [r1, r2].filter(r => r.status === 'rejected');
    expect(rejected).toHaveLength(1);

    // Database has exactly one lock
    const lock = await clientA.testEnvLock.findUnique({ where: { id: 'singleton' } });
    expect(lock).not.toBeNull();

    // The winner's requirementId is in the DB (not the old UUID_C)
    const winner = r1.status === 'fulfilled' ? r1.value : (r2.status === 'fulfilled' ? r2.value : null);
    expect(winner).not.toBeNull();
    expect(lock!.requirementId).toBe(winner!.acquiredForRequirement);
    expect(lock!.lockToken).toBe(winner!.lockToken);
    expect(lock!.lockToken).not.toBe(OLD_TOKEN);
  });

  // ── Scenario 3: Valid lock cannot be overridden ─────────────

  it('3. valid lock — both callers fail with 409, original lock unchanged', { timeout: INTEGRATION_TIMEOUT }, async () => {
    // Pre-seed a fresh valid lock using raw SQL to ensure exact column types
    const freshDate = new Date();
    await clientA.$executeRawUnsafe(
      `DELETE FROM "test_env_lock" WHERE "id" = 'singleton'`,
    );
    await clientA.$executeRawUnsafe(
      `INSERT INTO "test_env_lock" ("id", "requirementId", "requirementTitle", "acquiredAt", "lockToken")
       VALUES ('singleton', $1::uuid, 'fresh', $2, $3::uuid)`,
      UUID_A, freshDate, FRESH_TOKEN,
    );

    // Verify the lock is seeded
    const seeded = await clientA.testEnvLock.findUnique({ where: { id: 'singleton' } });
    expect(seeded).not.toBeNull();
    expect(seeded!.lockToken).toBe(FRESH_TOKEN);

    // Sequential calls: both should reject because the WHERE clause blocks both
    const r1 = await acquireTestEnvLock(UUID_B, 'req-b', null, { db: clientA, now: new Date() })
      .then(() => 'fulfilled' as const)
      .catch((e: unknown) => { expect((e as HttpError).statusCode).toBe(409); return 'rejected' as const; });
    const r2 = await acquireTestEnvLock(UUID_C, 'req-c', null, { db: clientB, now: new Date() })
      .then(() => 'fulfilled' as const)
      .catch((e: unknown) => { expect((e as HttpError).statusCode).toBe(409); return 'rejected' as const; });

    expect(r1).toBe('rejected');
    expect(r2).toBe('rejected');

    // Original lock completely unchanged
    const lock = await clientA.testEnvLock.findUnique({ where: { id: 'singleton' } });
    expect(lock!.requirementId).toBe(UUID_A);
    expect(lock!.lockToken).toBe(FRESH_TOKEN);
  });

  // ── Scenario 4: Release generational safety (triplet) ───────

  it('4. release safety — A acquires, B takes over, A cannot delete B lock', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const now = new Date();

    // A acquires
    const aOwnership = await acquireTestEnvLock(UUID_A, 'req-a', null, { db: clientA, now });
    expect(aOwnership).toBeTruthy();

    // Expire A's lock so B can take over
    const expiredDate = new Date(now.getTime() - TTL_MS - 120_000);
    await clientA.testEnvLock.update({
      where: { id: 'singleton' },
      data: { acquiredAt: expiredDate },
    });

    // B takes over
    const bOwnership = await acquireTestEnvLock(UUID_B, 'req-b', null, { db: clientB, now: new Date() });
    expect(bOwnership).toBeTruthy();
    expect(bOwnership.lockToken).not.toBe(aOwnership.lockToken);

    // A tries to release with old ownership → should fail (count === 0)
    const aReleaseResult = await releaseTestEnvLock(aOwnership, { db: clientA });
    expect(aReleaseResult).toBe(false);

    // B's lock is still in DB
    const lockAfterA = await clientA.testEnvLock.findUnique({ where: { id: 'singleton' } });
    expect(lockAfterA!.lockToken).toBe(bOwnership.lockToken);

    // Wrong requirementId cannot release
    const wrongReqOwnership = { ...bOwnership, acquiredForRequirement: UUID_C };
    const wrongReqResult = await releaseTestEnvLock(wrongReqOwnership, { db: clientA });
    expect(wrongReqResult).toBe(false);

    // Wrong token cannot release
    const wrongTokenOwnership = { ...bOwnership, lockToken: WRONG_TOKEN };
    const wrongTokenResult = await releaseTestEnvLock(wrongTokenOwnership, { db: clientA });
    expect(wrongTokenResult).toBe(false);

    // Same requirementId but different token (from past generation) cannot release
    const oldGenOwnership = { ...bOwnership, lockToken: aOwnership.lockToken };
    const oldGenResult = await releaseTestEnvLock(oldGenOwnership, { db: clientA });
    expect(oldGenResult).toBe(false);

    // B's correct triplet can release
    const bReleaseResult = await releaseTestEnvLock(bOwnership, { db: clientB });
    expect(bReleaseResult).toBe(true);

    // DB is now empty
    const lockAfterB = await clientA.testEnvLock.findUnique({ where: { id: 'singleton' } });
    expect(lockAfterB).toBeNull();

    // Repeated release is idempotent
    const repeatResult = await releaseTestEnvLock(bOwnership, { db: clientB });
    expect(repeatResult).toBe(false);
  });
});
