/**
 * CAS concurrency tests — verify atomic stateVersion transitions under race conditions.
 *
 * All concurrent tests use Promise.allSettled so both operations compete on the
 * same stateVersion read, then one CAS succeeds and the other gets 409.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '../utils/http-error.js';
import { casUpdateRequirement, txReadRequirement, txCreateTransition } from '../routes/requirements/workflow-cas-helper.js';

// ── Shared database-state counter for concurrency simulation ──
// Both CAS operations share this to simulate a real concurrent race.
let sharedDbStateVersion: number;

function resetDb() { sharedDbStateVersion = 0; }

/**
 * Create a mock Prisma transaction client that shares the database stateVersion counter.
 * 
 * Key design: all mocks created via mockTx() read/write the SAME sharedDbStateVersion.
 * When the first casUpdateRequirement succeeds (stateVersion matches), it increments
 * the shared counter, causing the second concurrent call to fail.
 */
function createMockTx() {
  return {
    requirement: {
      findUnique: vi.fn(async (args: any) => {
        if (args.where.id !== 'req-1') return null;
        return {
          id: 'req-1',
          currentStep: 'qa_review',
          assigneeId: 'u1',
          assignee: 'Tester',
          stateVersion: sharedDbStateVersion,
          status: 'qa_review',
          rejectReason: null,
          requesterId: 'r1',
          requester: 'Requester',
          workflowId: 'wf-1',
          workflowSnapshot: null,
        };
      }),
      updateMany: vi.fn(async (args: any) => {
        // Simulate atomic CAS: only succeed if stateVersion still matches
        if (args.where.stateVersion === sharedDbStateVersion) {
          sharedDbStateVersion += 1;
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    workflowTransition: { create: vi.fn().mockResolvedValue({ id: 't-1' }) },
  } as any;
}

describe('CAS advance concurrency', () => {
  beforeEach(() => { resetDb(); });

  it('double advance: one succeeds, one 409, stateVersion +1 once', async () => {
    const results = await Promise.allSettled([
      (async () => {
        const tx = createMockTx();
        const req = await txReadRequirement(tx, 'req-1');
        await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
          currentStep: 'test_env_deploy', assigneeId: 'ops-1',
        });
        await txCreateTransition(tx, {} as any);
      })(),
      (async () => {
        const tx = createMockTx();
        const req = await txReadRequirement(tx, 'req-1');
        await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
          currentStep: 'test_env_deploy', assigneeId: 'ops-2',
        });
        await txCreateTransition(tx, {} as any);
      })(),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (rejected[0]?.status === 'rejected') {
      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err instanceof HttpError || err.message?.includes('冲突')).toBe(true);
    }

    // stateVersion incremented exactly once (from 0 → 1, not 0 → 2)
    expect(sharedDbStateVersion).toBe(1);
  });

  it('advance vs reject: exactly one succeeds, one 409, single stateVersion increment', async () => {
    const results = await Promise.allSettled([
      (async () => {
        const tx = createMockTx();
        const req = await txReadRequirement(tx, 'req-1');
        await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
          currentStep: 'test_env_deploy', assigneeId: 'ops-1',
        });
        await txCreateTransition(tx, {
          requirement: { connect: { id: 'req-1' } },
          fromStep: 'qa_review', toStep: 'test_env_deploy',
          action: 'advance',
        } as any);
      })(),
      (async () => {
        const tx = createMockTx();
        const req = await txReadRequirement(tx, 'req-1');
        await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
          currentStep: 'dev_self_check', assigneeId: 'u1',
        });
        await txCreateTransition(tx, {
          requirement: { connect: { id: 'req-1' } },
          fromStep: 'qa_review', toStep: 'dev_self_check',
          action: 'reject',
        } as any);
      })(),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(sharedDbStateVersion).toBe(1);
  });
});

describe('CAS reject concurrency', () => {
  beforeEach(() => { resetDb(); });

  it('double reject: one succeeds, one 409, single increment', async () => {
    const results = await Promise.allSettled([
      (async () => {
        const tx = createMockTx();
        const req = await txReadRequirement(tx, 'req-1');
        await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
          currentStep: 'dev_self_check', assigneeId: 'u1',
        });
        await txCreateTransition(tx, {} as any);
      })(),
      (async () => {
        const tx = createMockTx();
        const req = await txReadRequirement(tx, 'req-1');
        await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
          currentStep: 'draft', assigneeId: 'r1',
        });
        await txCreateTransition(tx, {} as any);
      })(),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(sharedDbStateVersion).toBe(1);
  });
});

describe('CAS invariants', () => {
  beforeEach(() => { resetDb(); });

  it('CAS failure does NOT write transition', async () => {
    const tx = createMockTx();
    const req = await txReadRequirement(tx, 'req-1');
    const ok = await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
      currentStep: 'step2',
    });
    expect(ok).not.toBeNull();

    await txCreateTransition(tx, { requirement: { connect: { id: 'req-1' } }, fromStep: 'old', toStep: 'new', action: 'advance' } as any);
    expect(tx.workflowTransition.create).toHaveBeenCalledTimes(1);

    // Stale CAS → 409, no transition written
    const failed = await casUpdateRequirement(tx, 'req-1', 0, {
      currentStep: 'step3',
    }).catch((e: any) => e);

    expect(failed).toBeInstanceOf(HttpError);
    expect((failed as HttpError).statusCode).toBe(409);
    // Still exactly 1 transition (from the first, not from the failed CAS)
    expect(tx.workflowTransition.create).toHaveBeenCalledTimes(1);
  });

  it('stateVersion increments by exactly 1 per successful CAS', async () => {
    const tx = createMockTx();
    const req = await txReadRequirement(tx, 'req-1');
    expect(req.stateVersion).toBe(0);

    await casUpdateRequirement(tx, 'req-1', 0, { currentStep: 'step2' });
    expect(sharedDbStateVersion).toBe(1);

    // Read again, verify stateVersion is 1
    const req2 = await txReadRequirement(tx, 'req-1');
    expect(req2.stateVersion).toBe(1);

    // Second CAS from version 1
    await casUpdateRequirement(tx, 'req-1', 1, { currentStep: 'step3' });
    expect(sharedDbStateVersion).toBe(2);
  });

  it('transition and CAS: consistent step/assignee', async () => {
    const tx = createMockTx();
    const req = await txReadRequirement(tx, 'req-1');

    // CAS updates currentStep AND assigneeId atomically
    await casUpdateRequirement(tx, 'req-1', req.stateVersion ?? 0, {
      currentStep: 'test_env_deploy',
      assigneeId: 'ops-1',
    });

    // Transition reads the same target step
    await txCreateTransition(tx, {
      requirement: { connect: { id: 'req-1' } },
      fromStep: 'qa_review',
      toStep: 'test_env_deploy',
      action: 'advance',
    } as any);

    // Exactly one transition written
    expect(tx.workflowTransition.create).toHaveBeenCalledTimes(1);
    // stateVersion incremented by 1
    expect(sharedDbStateVersion).toBe(1);
  });
});
