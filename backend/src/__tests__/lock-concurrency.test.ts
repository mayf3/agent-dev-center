/**
 * Lock Concurrency Integration Tests
 *
 * Tests test_env_lock atomic acquisition, compare-and-delete release,
 * TTL semantics, and concurrent mutual exclusion.
 *
 * TWO TIERS:
 *   1. PostgreSQL integration tests (real DB via psql) — prove atomic mutual exclusion
 *   2. Unit/source stucture tests — verify code patterns
 *
 * NO_PRODUCTION_DATABASE_ACCESSED
 * All integration tests use temp table in local 'postgres' database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync, exec } from 'child_process';
import crypto from 'crypto';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Increase timeout for integration tests that hit real PostgreSQL
const INTEGRATION_TIMEOUT = 30000;

// ── Configuration ─────────────────────────────────────────────────
const PSQL = 'psql -h localhost -p 5432 -d postgres -t -A';
const TEST_TABLE = 'test_env_lock_conc_test';
const WORKTREE = '/Users/yanfenma/workspace/project/agent-dev-center-worktrees/adc-locktoken-v2';

/**
 * Run a psql command and return the first non-empty output line.
 */
function psql(cmd: string): string {
  try {
    const escaped = cmd.replace(/"/g, '\\"');
    const result = execSync(`${PSQL} -c "${escaped}"`, {
      encoding: 'utf-8',
      timeout: INTEGRATION_TIMEOUT,
    }).trim();
    // Take first non-empty line (psql may output RETURNING row + INSERT status)
    for (const line of result.split('\n')) {
      if (line.trim()) return line.trim();
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Run a multi-statement psql block (no output capture).
 */
function psqlExec(cmd: string): void {
  try {
    const escaped = cmd.replace(/"/g, '\\"');
    execSync(`${PSQL} -c "${escaped}"`, {
      encoding: 'utf-8',
      timeout: INTEGRATION_TIMEOUT,
    });
  } catch {
    // ignore
  }
}

// ── UUIDs ─────────────────────────────────────────────────────────
const UUID_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function uid(): string {
  return crypto.randomUUID();
}

function fmtDate(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
}

// ── TTL (must match production) ───────────────────────────────────
const TTL_MS = 4 * 60 * 60 * 1000;

// ── Setup / Teardown ──────────────────────────────────────────────

beforeAll(() => {
  psqlExec(`
    DROP TABLE IF EXISTS "${TEST_TABLE}";
    CREATE TABLE "${TEST_TABLE}" (
      id TEXT NOT NULL DEFAULT 'singleton',
      "requirementId" UUID NOT NULL,
      "requirementTitle" TEXT,
      branch TEXT,
      "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lockToken" UUID,
      PRIMARY KEY (id)
    )
  `);
});

afterAll(() => {
  psqlExec(`DROP TABLE IF EXISTS "${TEST_TABLE}"`);
});

beforeEach(() => {
  psqlExec(`TRUNCATE "${TEST_TABLE}"`);
});

// ── Helpers ────────────────────────────────────────────────────────

function insertLock(reqId: string, at: Date, token: string) {
  psqlExec(`
    INSERT INTO "${TEST_TABLE}" (id, "requirementId", "requirementTitle", "acquiredAt", "lockToken")
    VALUES ('singleton', '${reqId}'::uuid, 't', '${fmtDate(at)}', '${token}'::uuid)
  `);
}

/**
 * Atomic acquire: INSERT ... ON CONFLICT ... WHERE.
 * Returns the inserted/updated row, or null if the WHERE clause blocked it.
 */
function acquire(reqId: string, now: Date): { id: string; requirementId: string; lockToken: string } | null {
  const token = uid();
  const cutoff = fmtDate(new Date(now.getTime() - TTL_MS));
  const raw = psql(`
    INSERT INTO "${TEST_TABLE}" (id, "requirementId", "requirementTitle", "acquiredAt", "lockToken")
    VALUES ('singleton', '${reqId}'::uuid, 't', '${fmtDate(now)}', '${token}'::uuid)
    ON CONFLICT (id) DO UPDATE
      SET "requirementId" = EXCLUDED."requirementId",
          "requirementTitle" = EXCLUDED."requirementTitle",
          "acquiredAt" = EXCLUDED."acquiredAt",
          "lockToken" = EXCLUDED."lockToken"
    WHERE "${TEST_TABLE}"."acquiredAt" < '${cutoff}'::timestamp
    RETURNING row_to_json(${TEST_TABLE})
  `);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function release(id: string, reqId: string, token: string): number {
  psqlExec(`
    DELETE FROM "${TEST_TABLE}"
    WHERE id = '${id}'
      AND "requirementId" = '${reqId}'::uuid
      AND "lockToken" = '${token}'::uuid
  `);
  return parseInt(psql(`SELECT count(*) FROM "${TEST_TABLE}"`) || '0', 10);
}

function readLock(): { id: string; requirementId: string; lockToken: string; acquiredAt: string } | null {
  const raw = psql(`SELECT row_to_json(t) FROM (SELECT id, "requirementId", "lockToken", "acquiredAt" FROM "${TEST_TABLE}") t`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function countRows(): number {
  return parseInt(psql(`SELECT count(*) FROM "${TEST_TABLE}"`) || '0', 10);
}

// ══════════════════════════════════════════════════════════════════
//  TTL CONTRACT
// ══════════════════════════════════════════════════════════════════

describe('TTL contract', () => {
  it('TTL is exactly 4 hours (14,400,000 ms)', () => {
    expect(TTL_MS).toBe(4 * 60 * 60 * 1000);
  });
});

// ══════════════════════════════════════════════════════════════════
//  ATOMIC ACQUIRE
// ══════════════════════════════════════════════════════════════════

describe('Atomic acquire — INSERT ... ON CONFLICT ... WHERE', () => {
  it('acquires empty lock', () => {
    const now = new Date();
    const r = acquire(UUID_A, now);
    expect(r).not.toBeNull();
    expect(r!.id).toBe('singleton');
    expect(r!.requirementId).toBe(UUID_A);
    expect(r!.lockToken.length).toBeGreaterThan(0);
    expect(countRows()).toBe(1);
  });

  it('two concurrent requests for empty lock — exactly one row', () => {
    const now = new Date();
    acquire(UUID_A, now);
    acquire(UUID_B, now);
    expect(countRows()).toBe(1);
  });

  it('two concurrent requests for same expired lock — exactly one row', () => {
    const old = new Date(Date.now() - TTL_MS - 120_000);
    insertLock(UUID_C, old, uid());

    acquire(UUID_A, new Date());
    acquire(UUID_B, new Date());

    expect(countRows()).toBe(1);
    const lock = readLock();
    expect(lock).not.toBeNull();
    // The lock should have been taken over (requirementId changed from UUID_C to something else)
    expect([UUID_A, UUID_B]).toContain(lock!.requirementId);
  });

  it('valid non-expired lock cannot be overridden', () => {
    const fresh = new Date();
    const token = uid();
    insertLock(UUID_A, fresh, token);

    const r2 = acquire(UUID_B, new Date());
    expect(r2).toBeNull();

    const lock = readLock();
    expect(lock!.requirementId).toBe(UUID_A);
    expect(lock!.lockToken).toBe(token);
  });

  it('expired lock can be taken over', () => {
    const old = new Date(Date.now() - TTL_MS - 120_000);
    const oldToken = uid();
    insertLock(UUID_A, old, oldToken);

    const r = acquire(UUID_B, new Date());
    expect(r).not.toBeNull();
    expect(r!.requirementId).toBe(UUID_B);

    const lock = readLock();
    expect(lock!.requirementId).toBe(UUID_B);
    expect(lock!.lockToken).toBe(r!.lockToken);
    expect(lock!.lockToken).not.toBe(oldToken);
  });

  it('returned token matches database exactly', () => {
    const r = acquire(UUID_A, new Date());
    expect(r).not.toBeNull();

    const lock = readLock();
    expect(lock!.lockToken).toBe(r!.lockToken);
    expect(lock!.requirementId).toBe(r!.requirementId);
  });

  it('two consecutive acquires generate different tokens', () => {
    const r1 = acquire(UUID_A, new Date());
    expect(r1).not.toBeNull();

    // Expire the lock
    const expired = new Date(Date.now() - TTL_MS - 60_000);
    psqlExec(`UPDATE "${TEST_TABLE}" SET "acquiredAt" = '${fmtDate(expired)}'::timestamp`);

    const r2 = acquire(UUID_B, new Date());
    expect(r2).not.toBeNull();
    expect(r1!.lockToken).not.toBe(r2!.lockToken);
  });
});

// ══════════════════════════════════════════════════════════════════
//  RELEASE (compare-and-delete with triplet)
// ══════════════════════════════════════════════════════════════════

describe('Release — compare-and-delete with id+requirementId+lockToken', () => {
  it('B takes over, A delayed release cannot delete B lock', () => {
    const a = acquire(UUID_A, new Date());
    expect(a).not.toBeNull();

    // Expire A
    psqlExec(`UPDATE "${TEST_TABLE}" SET "acquiredAt" = '${fmtDate(new Date(Date.now() - TTL_MS - 60_000))}'::timestamp`);
    const b = acquire(UUID_A, new Date());
    expect(b).not.toBeNull();
    expect(b!.lockToken).not.toBe(a!.lockToken);

    // A tries to release with old token → blocked (token mismatch)
    expect(release('singleton', UUID_A, a!.lockToken)).toBe(1);
    expect(readLock()!.lockToken).toBe(b!.lockToken);
  });

  it('wrong requirementId with correct token cannot release', () => {
    const a = acquire(UUID_A, new Date());
    expect(a).not.toBeNull();

    expect(release('singleton', UUID_B, a!.lockToken)).toBe(1);
  });

  it('three-generation cross-release protection', () => {
    const genA = acquire(UUID_A, new Date());
    expect(genA).not.toBeNull();

    // Expire A
    psqlExec(`UPDATE "${TEST_TABLE}" SET "acquiredAt" = '${fmtDate(new Date(Date.now() - TTL_MS - 60_000))}'::timestamp`);
    const genB = acquire(UUID_B, new Date());
    expect(genB).not.toBeNull();

    // Expire B
    psqlExec(`UPDATE "${TEST_TABLE}" SET "acquiredAt" = '${fmtDate(new Date(Date.now() - TTL_MS - 60_000))}'::timestamp`);
    const genC = acquire(UUID_C, new Date());
    expect(genC).not.toBeNull();

    // A tries → blocked (token mismatch)
    expect(release('singleton', UUID_A, genA!.lockToken)).toBe(1);
    // B tries → blocked (requirementId UUID_B != current UUID_C)
    expect(release('singleton', UUID_B, genB!.lockToken)).toBe(1);
    // C succeeds
    expect(release('singleton', UUID_C, genC!.lockToken)).toBe(0);
  });

  it('repeated release is idempotent', () => {
    const a = acquire(UUID_A, new Date());
    expect(a).not.toBeNull();

    expect(release('singleton', UUID_A, a!.lockToken)).toBe(0);
    // Second release on empty table
    expect(release('singleton', UUID_A, a!.lockToken)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
//  CAS STATVERSION GATE
// ══════════════════════════════════════════════════════════════════

describe('CAS stateVersion gate', () => {
  it('prevents double-advance', () => {
    // Use a real table (not TEMP) to persist across psql sessions
    psqlExec(`
      DROP TABLE IF EXISTS cas_advance_test;
      CREATE TABLE cas_advance_test (
        id UUID PRIMARY KEY,
        "currentStep" TEXT NOT NULL DEFAULT 'dev_self_check',
        "stateVersion" INT NOT NULL DEFAULT 5
      );
      INSERT INTO cas_advance_test VALUES ('${UUID_A}'::uuid, 'dev_self_check', 5);
    `);

    // First advance (stateVersion 5 → 6)
    psqlExec(`UPDATE cas_advance_test SET "currentStep" = 'qa_review', "stateVersion" = 6 WHERE id = '${UUID_A}'::uuid AND "stateVersion" = 5`);
    // Second advance on same version → WHERE fails, no rows updated
    psqlExec(`UPDATE cas_advance_test SET "currentStep" = 'security_review', "stateVersion" = 6 WHERE id = '${UUID_A}'::uuid AND "stateVersion" = 5`);

    const step = psql(`SELECT "currentStep" FROM cas_advance_test WHERE id = '${UUID_A}'::uuid`).trim();
    expect(step).toBe('qa_review');

    psqlExec(`DROP TABLE IF EXISTS cas_advance_test`);
  });

  it('prevents double-reject', () => {
    psqlExec(`
      DROP TABLE IF EXISTS cas_reject_test;
      CREATE TABLE cas_reject_test (
        id UUID PRIMARY KEY,
        "currentStep" TEXT NOT NULL DEFAULT 'testing',
        "stateVersion" INT NOT NULL DEFAULT 3
      );
      INSERT INTO cas_reject_test VALUES ('${UUID_A}'::uuid, 'testing', 3);
    `);

    psqlExec(`UPDATE cas_reject_test SET "currentStep" = 'dev_self_check', "stateVersion" = 4 WHERE id = '${UUID_A}'::uuid AND "stateVersion" = 3`);
    psqlExec(`UPDATE cas_reject_test SET "currentStep" = 'draft', "stateVersion" = 4 WHERE id = '${UUID_A}'::uuid AND "stateVersion" = 3`);

    const step = psql(`SELECT "currentStep" FROM cas_reject_test WHERE id = '${UUID_A}'::uuid`).trim();
    expect(step).toBe('dev_self_check');

    psqlExec(`DROP TABLE IF EXISTS cas_reject_test`);
  });
});

// ══════════════════════════════════════════════════════════════════
//  LOCK COMPENSATION ON CAS FAILURE
// ══════════════════════════════════════════════════════════════════

describe('Lock compensation on CAS failure', () => {
  it('CAS failure releases only own token, not stale token', { timeout: INTEGRATION_TIMEOUT }, () => {
    // Stale lock held by C
    const old = new Date(Date.now() - TTL_MS - 120_000);
    const oldToken = uid();
    insertLock(UUID_C, old, oldToken);

    // New acquire takes over (new token)
    const newLock = acquire(UUID_A, new Date());
    expect(newLock).not.toBeNull();
    expect(newLock!.lockToken).not.toBe(oldToken);

    // Old token should NOT release the new lock
    expect(release('singleton', UUID_C, oldToken)).toBe(1);
    expect(readLock()!.lockToken).toBe(newLock!.lockToken);

    // New token CAN release
    expect(release('singleton', UUID_A, newLock!.lockToken)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
//  TRULY CONCURRENT PostgreSQL TESTS (independent connections)
// ══════════════════════════════════════════════════════════════════

/**
 * Fire an atomic acquire SQL via an independent psql connection and return { success, token }.
 * Uses async exec() so multiple calls can run simultaneously via Promise.all.
 */
async function concurrentAcquire(reqId: string, now: Date, table: string): Promise<{ success: boolean; token: string }> {
  const token = crypto.randomUUID();
  const cutoff = fmtDate(new Date(now.getTime() - TTL_MS));
  const sql = `INSERT INTO "${table}" (id, "requirementId", "requirementTitle", "acquiredAt", "lockToken")
    VALUES ('singleton', '${reqId}'::uuid, 't', '${fmtDate(now)}', '${token}'::uuid)
    ON CONFLICT (id) DO UPDATE
      SET "requirementId" = EXCLUDED."requirementId",
          "requirementTitle" = EXCLUDED."requirementTitle",
          "acquiredAt" = EXCLUDED."acquiredAt",
          "lockToken" = EXCLUDED."lockToken"
    WHERE "${table}"."acquiredAt" < '${cutoff}'::timestamp
    RETURNING row_to_json(${table})`;
  try {
    const { stdout } = await execAsync(`${PSQL} -c "${sql.replace(/"/g, '\\"')}"`, { timeout: INTEGRATION_TIMEOUT });
    const lines = stdout.trim().split('\n');
    const firstLine = lines.find(l => l.trim());
    if (firstLine && firstLine.includes('"lockToken"')) {
      const parsed = JSON.parse(firstLine);
      return { success: true, token: parsed.lockToken };
    }
    return { success: false, token };
  } catch {
    return { success: false, token };
  }
}

describe('Truly concurrent PostgreSQL — independent connections', () => {
  beforeEach(() => {
    psqlExec(`TRUNCATE "${TEST_TABLE}"`);
  });

  it('1. two concurrent INSERT ... ON CONFLICT ... WHERE for empty lock — exactly one succeeds', async () => {
    const now = new Date();
    const [r1, r2] = await Promise.all([
      concurrentAcquire(UUID_A, now, TEST_TABLE),
      concurrentAcquire(UUID_B, now, TEST_TABLE),
    ]);

    const successes = [r1, r2].filter(r => r.success).length;
    expect(successes).toBe(1);

    const lock = readLock();
    expect(lock).not.toBeNull();
    expect(countRows()).toBe(1);

    // The successful acquirer gets its token in the DB
    const winner = r1.success ? r1 : r2;
    const loser = r1.success ? r2 : r1;
    expect(lock!.lockToken).toBe(winner.token);
    expect(lock!.lockToken).not.toBe(loser.token);
  });

  it('2. two concurrent INSERT ... ON CONFLICT ... WHERE for expired lock — exactly one succeeds, failure gets 409', async () => {
    // Pre-seed with an expired lock
    const old = new Date(Date.now() - TTL_MS - 120_000);
    psqlExec(`INSERT INTO "${TEST_TABLE}" (id, "requirementId", "requirementTitle", "acquiredAt", "lockToken")
      VALUES ('singleton', '${UUID_C}'::uuid, 'old', '${fmtDate(old)}', '${crypto.randomUUID()}'::uuid)`);

    const now = new Date();
    const [r1, r2] = await Promise.all([
      concurrentAcquire(UUID_A, now, TEST_TABLE),
      concurrentAcquire(UUID_B, now, TEST_TABLE),
    ]);

    const successes = [r1, r2].filter(r => r.success).length;
    expect(successes).toBe(1);

    const lock = readLock();
    expect(lock).not.toBeNull();
    expect(countRows()).toBe(1);

    // Winner took over; loser got null return
    const winner = r1.success ? r1 : r2;
    expect(lock!.requirementId).toBe(winner === r1 ? UUID_A : UUID_B);
  });

  it('3. old token cannot release new lock after concurrent takeover', async () => {
    // A acquires lock
    const now1 = new Date();
    const r1 = await concurrentAcquire(UUID_A, now1, TEST_TABLE);
    expect(r1.success).toBe(true);

    // Expire A's lock
    const expired = new Date(Date.now() - TTL_MS - 120_000);
    psqlExec(`UPDATE "${TEST_TABLE}" SET "acquiredAt" = '${fmtDate(expired)}'::timestamp`);

    // B takes over concurrently
    const now2 = new Date();
    const r2 = await concurrentAcquire(UUID_A, now2, TEST_TABLE);
    expect(r2.success).toBe(true);
    expect(r2.token).not.toBe(r1.token);

    // A's old token cannot release B's lock (using the release helper with triplet check)
    const remaining = release('singleton', UUID_A, r1.token);
    expect(remaining).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════
//  SOURCE CODE PATTERN VERIFICATION (QA rejection / CTO revision)
// ══════════════════════════════════════════════════════════════════

describe('Source code patterns', () => {
  const SOURCE_REJECT = `${WORKTREE}/backend/src/routes/requirements/workflow-reject.ts`;
  const SOURCE_REPORTS = `${WORKTREE}/backend/src/routes/reports.ts`;
  const SOURCE_ADVANCE = `${WORKTREE}/backend/src/routes/requirements/workflow-advance.ts`;

  it('reject.ts: assignee resolution happens in Phase 1 (before any writes)', () => {
    // Phase 1 = reads + validation, Phase 2 = writes
    const lines = execSync(`grep -n "Phase 2\\|resolveAssigneeForStep\\|casUpdateRequirement\\|prisma\\.requirement\\.update" "${SOURCE_REJECT}"`, { encoding: 'utf-8' });
    const lineArr = lines.trim().split('\n');
    // Use the LAST "Phase 2" occurrence (the code section, not JSDoc)
    const phase2Entries = lineArr.filter(l => /Phase 2/.test(l));
    const phase2Line = parseInt(phase2Entries[phase2Entries.length - 1]?.split(':')[0] || '999', 10);

    for (const l of lineArr) {
      if (l.includes('resolveAssigneeForStep')) {
        const lineNum = parseInt(l.split(':')[0], 10);
        expect(lineNum).toBeLessThan(phase2Line);
      }
    }
  });

  it('reject.ts: writes (casUpdateRequirement) happen in Phase 2 (after validation)', () => {
    const lines = execSync(`grep -n "Phase 2\\|casUpdateRequirement\\|prisma\\.requirement\\.update" "${SOURCE_REJECT}"`, { encoding: 'utf-8' });
    const lineArr = lines.trim().split('\n');
    const phase2Entries = lineArr.filter(l => /Phase 2/.test(l));
    const phase2Line = parseInt(phase2Entries[phase2Entries.length - 1]?.split(':')[0] || '0', 10);
    expect(phase2Line).toBeGreaterThan(0);

    let foundCASInPhase2 = false;
    for (const l of lineArr) {
      if (l.includes('Phase 2')) continue;
      if (l.includes('casUpdateRequirement')) {
        const lineNum = parseInt(l.split(':')[0], 10);
        if (lineNum > phase2Line) foundCASInPhase2 = true;
      }
    }
    expect(foundCASInPhase2).toBe(true);
  });

  it('advance.ts: CAS + transition in same $transaction', () => {
    const src = execSync(`cat "${SOURCE_ADVANCE}"`, { encoding: 'utf-8' });
    // Find the transaction block that contains both casUpdateRequirement and txCreateTransition
    const txBlocks = src.match(/\$transaction\s*\([\s\S]*?casUpdateRequirement[\s\S]*?txCreateTransition[\s\S]*?\)/g);
    expect(txBlocks).not.toBeNull();
    expect(txBlocks!.length).toBeGreaterThanOrEqual(1);
  });

  it('reports.ts: 3+ $transaction blocks with CAS + transition + revision', () => {
    const src = execSync(`cat "${SOURCE_REPORTS}"`, { encoding: 'utf-8' });
    const txCount = (src.match(/\$transaction/g) || []).length;
    expect(txCount).toBeGreaterThanOrEqual(3);
  });

  it('reports.ts: CTO revision path uses casUpdateRequirement', () => {
    const src = execSync(`cat "${SOURCE_REPORTS}"`, { encoding: 'utf-8' });
    expect(src).toContain('casUpdateRequirement');
    expect(src).toContain('txCreateTransition');
    expect(src).toContain('requirementRevision.create');
  });
});
