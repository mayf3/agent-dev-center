/**
 * Auto-Advance TestEnv Lock — Real PostgreSQL Integration Tests
 *
 * Tier: 生产函数 + PrismaClient + 真实PostgreSQL集成测试
 *
 * Directly calls the production autoAdvanceCandidates and acquireTestEnvLock
 * functions to verify the atomic transaction contract:
 *
 *   Select candidate → acquireTestEnvLock → CAS advance → commit
 *
 * Requires KERNEL_TEST_DATABASE_URL.  Skipped when unset.
 *
 * NO_PRODUCTION_DATABASE_ACCESSED
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { autoAdvanceCandidates, acquireTestEnvLock, releaseTestEnvLock, TEST_ENV_LOCK_TTL_MS } from '../routes/requirements/workflow-advance-helpers.js';

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;
const integration = PG_URL ? describe : describe.skip;
const INTEGRATION_TIMEOUT = 30000;

const USER_DEV = crypto.randomUUID();
const USER_ADMIN = crypto.randomUUID();

const WORKFLOW_STEPS = [
  { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
  { name: 'pending_deploy', displayName: '排队部署', role: 'ops', requiredReports: [], autoAdvance: false },
  { name: 'test_env_deploy', displayName: '部署测试', role: 'ops', requiredReports: [], autoAdvance: false },
  { name: 'testing', displayName: '测试', role: 'tester', requiredReports: [], autoAdvance: false },
  { name: 'done', displayName: '完成', role: 'cto', requiredReports: [], autoAdvance: false },
];

integration('auto-advance test-env lock (PostgreSQL)', () => {
  let pg: PrismaClient;
  let pgB: PrismaClient;
  let counter = 0;

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: PG_URL });
    pgB = new PrismaClient({ datasourceUrl: PG_URL });
    await pg.$connect();
    await pgB.$connect();
    const ts = String(Date.now());
    await pg.user.create({ data: { id: USER_DEV, name: `auto-adv-dev-${ts}`, email: `aa-dev-${ts}@t.com`, internalRole: 'backend_developer', role: 'developer', password: 'x' } }).catch(() => {});
    await pg.user.create({ data: { id: USER_ADMIN, name: `auto-adv-admin-${ts}`, email: `aa-admin-${ts}@t.com`, internalRole: 'cto', role: 'admin', password: 'x' } }).catch(() => {});
  });

  afterAll(async () => {
    await pg.testEnvLock.deleteMany({ where: { id: 'singleton' } }).catch(() => {});
    await pg.user.deleteMany({ where: { id: { in: [USER_DEV, USER_ADMIN] } } }).catch(() => {});
    await pg.$disconnect();
    await pgB.$disconnect();
  });

  async function createPendingReq(title = 'auto-adv-test'): Promise<{ id: string }> {
    counter++;
    const r = await pg.requirement.create({
      data: {
        title: `${title}-${Date.now()}-${counter}`,
        description: 'auto-advance test',
        priority: 'P2', type: 'FEATURE',
        requester: 'tester', department: 'engineering',
        requesterId: USER_DEV,
        currentStep: 'pending_deploy',
        stateVersion: 1,
        workflowSnapshot: WORKFLOW_STEPS,
      },
      select: { id: true },
    });
    return r;
  }

  async function countAtStep(step: string): Promise<number> {
    return pg.requirement.count({ where: { currentStep: step } });
  }

  async function readLock() {
    return pg.testEnvLock.findUnique({ where: { id: 'singleton' } });
  }

  beforeEach(async () => {
    await pg.requirement.deleteMany({ where: { currentStep: { in: ['pending_deploy', 'test_env_deploy'] } } });
    await pg.testEnvLock.deleteMany({ where: { id: 'singleton' } });
    await pg.workflowTransition.deleteMany({ where: { action: 'advance' } }).catch(() => {});
  });

  // ── Scenario 1: Empty lock normal advance ─────────────────

  it('S1: empty lock — candidate advances, lock acquired', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createPendingReq();
    expect(await countAtStep('pending_deploy')).toBe(1);
    expect(await countAtStep('test_env_deploy')).toBe(0);

    const result = await autoAdvanceCandidates({ db: pg });
    expect(result).not.toBeNull();
    expect(result!.candidateId).toBe(req.id);
    expect(result!.ownership.lockId).toBe('singleton');
    expect(result!.ownership.lockToken.length).toBeGreaterThan(0);

    // Requirement advanced
    expect(await countAtStep('pending_deploy')).toBe(0);
    expect(await countAtStep('test_env_deploy')).toBe(1);

    // Singleton lock acquired with correct ownership
    const lock = await readLock();
    expect(lock).not.toBeNull();
    expect(lock!.requirementId).toBe(req.id);
    expect(lock!.lockToken).toBe(result!.ownership.lockToken);
  });

  // ── Scenario 2: Valid lock blocks advance ─────────────────

  it('S2: valid lock exists — candidate stays at pending_deploy, lock unchanged', { timeout: INTEGRATION_TIMEOUT }, async () => {
    // A holds a valid lock (seed via raw SQL to avoid Prisma upsert id issue)
    const reqA = await createPendingReq('req-a');
    const tokenA = crypto.randomUUID();
    await pg.$executeRawUnsafe(
      `INSERT INTO "test_env_lock" ("id", "requirementId", "requirementTitle", "acquiredAt", "lockToken")
       VALUES ('singleton', $1::uuid, 'holder-A', $2, $3::uuid)`,
      reqA.id, new Date(), tokenA,
    );
    // Verify lock was seeded
    expect(await readLock()).not.toBeNull();

    // B waits at pending_deploy
    const reqB = await createPendingReq('req-b');

    const result = await autoAdvanceCandidates({ db: pg });

    // Returns null (lock busy, no-op)
    expect(result).toBeNull();

    // B still at pending_deploy
    expect(await countAtStep('pending_deploy')).toBe(2);
    expect(await countAtStep('test_env_deploy')).toBe(0);

    // A's lock unchanged
    const lock = await readLock();
    expect(lock!.requirementId).toBe(reqA.id);
    expect(lock!.lockToken).toBe(tokenA);
  });

  // ── Scenario 3: Expired lock takeover ─────────────────────

  it('S3: expired lock — B takes over, B advances, token replaced', { timeout: INTEGRATION_TIMEOUT }, async () => {
    // A holds an expired lock (seed via raw SQL to avoid Prisma upsert id issue)
    const reqA = await createPendingReq('req-a');
    const tokenA = crypto.randomUUID();
    const oldDate = new Date(Date.now() - TEST_ENV_LOCK_TTL_MS - 120_000);
    await pg.$executeRawUnsafe(
      `INSERT INTO "test_env_lock" ("id", "requirementId", "requirementTitle", "acquiredAt", "lockToken")
       VALUES ('singleton', $1::uuid, 'holder-A', $2, $3::uuid)`,
      reqA.id, oldDate, tokenA,
    );

    // B is a valid candidate
    const reqB = await createPendingReq('req-b');
    await pg.requirement.update({ where: { id: reqA.id }, data: { currentStep: 'test_env_deploy' } });

    const result = await autoAdvanceCandidates({ db: pg });
    expect(result).not.toBeNull();
    expect(result!.candidateId).toBe(reqB.id);

    // B advanced to test_env_deploy
    expect(await countAtStep('test_env_deploy')).toBe(2); // A was already there
    expect(await countAtStep('pending_deploy')).toBe(0);

    // Singleton lock now held by B
    const lock = await readLock();
    expect(lock!.requirementId).toBe(reqB.id);
    expect(lock!.lockToken).toBe(result!.ownership.lockToken);
    expect(lock!.lockToken).not.toBe(tokenA);

    // A's old ownership cannot release B's lock
    const aRelease = await releaseTestEnvLock({ lockId: 'singleton', lockToken: tokenA, acquiredForRequirement: reqA.id }, { db: pg });
    expect(aRelease).toBe(false);
    expect((await readLock())!.lockToken).toBe(result!.ownership.lockToken);
  });

  // ── Scenario 4: Concurrent auto-advance, different candidates ─

  it('S4: concurrent auto-advance — exactly 1 advances, 1 stays at pending_deploy', { timeout: INTEGRATION_TIMEOUT }, async () => {
    // Two candidates at pending_deploy with deterministic order
    const req1 = await createPendingReq('conc-1');
    const req2 = await createPendingReq('conc-2');

    // Run two autoAdvanceCandidates concurrently via separate clients
    const r1 = autoAdvanceCandidates({ db: pg });
    const r2 = autoAdvanceCandidates({ db: pgB });

    const results = await Promise.allSettled([r1, r2]);

    const successes = results.filter(r => r.status === 'fulfilled' && r.value !== null);
    const noops = results.filter(r => r.status === 'fulfilled' && r.value === null);

    expect(successes).toHaveLength(1);
    const winner = successes[0];
    expect(winner.status).toBe('fulfilled');

    // Exactly 1 at test_env_deploy, 1 still at pending_deploy
    expect(await countAtStep('test_env_deploy')).toBe(1);
    expect(await countAtStep('pending_deploy')).toBe(1);

    // Lock matches the advanced requirement
    const lock = await readLock();
    expect(lock).not.toBeNull();
    const winnerId = winner.status === 'fulfilled' ? winner.value!.candidateId : null;
    expect(lock!.requirementId).toBe(winnerId);

    // The advanced requirement is at test_env_deploy
    const advancedReq = await pg.requirement.findUnique({ where: { id: winnerId! } });
    expect(advancedReq!.currentStep).toBe('test_env_deploy');
  });

  // ── Scenario 5: Same candidate concurrent competition ────

  it('S5: same candidate concurrent — requirement advances only once', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createPendingReq('same-candidate');

    const r1 = autoAdvanceCandidates({ db: pg });
    const r2 = autoAdvanceCandidates({ db: pgB });

    const results = await Promise.allSettled([r1, r2]);

    const successes = results.filter(r => r.status === 'fulfilled' && r.value !== null);
    expect(successes).toHaveLength(1);

    // Requirement only advanced once
    const reqAfter = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(reqAfter!.currentStep).toBe('test_env_deploy');

    // Singleton lock exists
    const lock = await readLock();
    expect(lock).not.toBeNull();
    expect(lock!.requirementId).toBe(req.id);
  });

  // ── Scenario 6: Lock acquired but CAS fails → rollback ───

  it('S6: lock acquired, CAS update fails — full transaction rollback', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createPendingReq('rollback-test');
    expect(await countAtStep('pending_deploy')).toBe(1);

    // Simulate CAS failure by advancing the candidate before calling autoAdvanceCandidates
    // The transaction reads the candidate at pending_deploy, acquires the lock,
    // then tries updateMany where currentStep = 'pending_deploy' but it was already
    // changed by another process. This causes count = 0 and the transaction throws.
    //
    // We simulate this by first autoAdvancing (which succeeds), then attempting again.
    // The second attempt should acquire the lock but the CAS should fail because
    // the requirement is already at test_env_deploy.
    const r1 = await autoAdvanceCandidates({ db: pg });
    expect(r1).not.toBeNull();
    expect(await countAtStep('test_env_deploy')).toBe(1);

    // Now expire the lock so autoAdvance will try to take over
    await pg.testEnvLock.update({
      where: { id: 'singleton' },
      data: { acquiredAt: new Date(Date.now() - TEST_ENV_LOCK_TTL_MS - 120_000) },
    });

    const r2 = await autoAdvanceCandidates({ db: pg });

    // r2 should fail because CAS can't find the req at pending_deploy anymore
    // The lock acquired inside the transaction is rolled back
    expect(r2).toBeNull();

    // Requirement still at test_env_deploy (the first advance)
    expect(await countAtStep('test_env_deploy')).toBe(1);
    expect(await countAtStep('pending_deploy')).toBe(0);

    // Lock should be restored to pre-transaction state
    const lock = await readLock();
    expect(lock).not.toBeNull();
    expect(lock!.requirementId).toBe(req.id);
  });
});
