import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '../utils/http-error.js';

const mockPrisma = {
  requirement: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  workflowTransition: { create: vi.fn() },
  executionLease: {
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  },
  executionLeaseEvent: { findUnique: vi.fn(), create: vi.fn() },
  testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  $transaction: vi.fn(),
  workflowTemplate: { findFirst: vi.fn() },
  requirementReport: { findUnique: vi.fn(), updateMany: vi.fn() },
  requirementRevision: { create: vi.fn(), findFirst: vi.fn() },
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
};

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }));

function mkLease(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lease-uuid-1', requirementId: 'req-uuid-1', workflowStep: 'dev_self_check',
    expectedStateVersion: 0, ownerUserId: 'user-uuid-1', ownerAgentId: null,
    sessionId: 'session-1', claimKey: 'k1', status: 'ACTIVE',
    acquiredAt: new Date(), heartbeatAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    releasedAt: null, releaseReason: null, worktreePath: null, gitBranch: null,
    createdAt: new Date(), updatedAt: new Date(),
    requirement: { currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1', repoPath: '/main/repo' },
    owner: { id: 'user-uuid-1', name: 'TestUser', email: 'test@example.com' },
    ...overrides,
  };
}

async function loadAdvanceKernel() {
  return import('../lib/workflow-transition/transition-advance.js');
}

async function loadRejectKernel() {
  return import('../lib/workflow-transition/transition-reject.js');
}

const actor = { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null };
const execution = { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-advance-1', expectedStateVersion: 0 };

describe('workflow-transition advance kernel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('replays before checking requirement state when idempotencyKey exists with ADVANCED event', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing', newStateVersion: 1, newAssigneeId: 'user-uuid-2', newAssigneeName: 'User2', lockReleased: false, isDone: false },
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const result = await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: 'user-uuid-2', newAssigneeName: 'User2',
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(result.replayed).toBe(true);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('replay with wrong operation type returns 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'REJECTED', lease: mkLease(), metadata: {},
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('different operation type');
    }
  });

  it('replay with different requirement returns 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease({ requirementId: 'other-req' }), metadata: {},
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('replay with different actor returns 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease({ ownerUserId: 'other-user' }), metadata: {},
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('different actor');
    }
  });

  it('atomic updateMany predicate includes id, currentStep, stateVersion and increments stateVersion', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let updateManyCalled = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }),
          updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
            updateManyCalled = true;
            expect(where.id).toBe('req-uuid-1');
            expect(where.currentStep).toBe('dev_self_check');
            expect(where.stateVersion).toBe(0);
            expect(data.stateVersion).toEqual({ increment: 1 });
            return { count: 1 };
          }),
        },
        executionLease: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(mkLease()) },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), delete: vi.fn() },
      };
      tx.requirement.findUnique = vi.fn()
        .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
        .mockResolvedValueOnce({ stateVersion: 1 });
      await cb(tx);
      expect(updateManyCalled).toBe(true);
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('WorkflowTransition + lease terminal status + ADVANCED event use same transaction client', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let txClientUsed: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease()),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), delete: vi.fn() },
      };
      txClientUsed = tx;
      await cb(tx);
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(txClientUsed).not.toBeNull();
    expect(txClientUsed.workflowTransition.create).toHaveBeenCalled();
    expect(txClientUsed.executionLease.updateMany).toHaveBeenCalled();
    expect(txClientUsed.executionLeaseEvent.create).toHaveBeenCalled();
  });

  it('no transition/event/lock survives a failed atomic update (updateMany count=0)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        executionLease: { findUnique: vi.fn().mockResolvedValue(mkLease()) },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      try { await cb(tx); } catch { /* expected */ }
      expect(tx.executionLeaseEvent.create).not.toHaveBeenCalled();
      expect(tx.workflowTransition.create).not.toHaveBeenCalled();
      return { __expired: true, reason: 'concurrent modification' };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('expired lease sentinel commits cleanup before outer 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let expiredEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ expiresAt: new Date(Date.now() - 1000) })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.expiresAt?.lte) return { count: 1 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { expiredEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      const result = await cb(tx);
      expect(expiredEventCreated).toBe(true);
      return result;
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('expired');
    }
  });

  it('branch change is not written before commit (kernel handles it atomically)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let branchInUpdate = '';
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockImplementation(({ data }: any) => {
            branchInUpdate = data.branch ?? '';
            return { count: 1 };
          }),
        },
        executionLease: { findUnique: vi.fn().mockResolvedValue(mkLease()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done', effectiveBranch: 'main',
    });
    expect(branchInUpdate).toBe('main');
  });

  it('P2002 concurrency maps to 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('P2034 serialization conflict maps to 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error('Serialization failure'), { code: 'P2034' }),
    );
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('human transition (no execution) invalidates ACTIVE lease and emits INVALIDATED event', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let invalidatedEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findFirst: vi.fn().mockResolvedValue({ id: 'lease-uuid-1' }),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') return { count: 1 };
            if (where.expiresAt?.lte) return { count: 0 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { invalidatedEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor,
      lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(invalidatedEventCreated).toBe(true);
  });

  it('test-env lock acquire/release uses same transaction client', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let lockUpsertCalled = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease()),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockImplementation(() => { lockUpsertCalled = true; return {}; }),
          delete: vi.fn(),
        },
      };
      await cb(tx);
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'test_env_deploy', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'test_env_deploy',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'acquire', title: 'Test', branch: 'main' }, finalStepName: 'done',
    });
    expect(lockUpsertCalled).toBe(true);
  });
});

describe('workflow-transition reject kernel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const rejectActor = { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null };
  const rejectExecution = { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-reject-1', expectedStateVersion: 0 };

  it('replays exact reject before checking requirement state', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'REJECTED', lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'testing', toStep: 'dev_self_check', newStateVersion: 1, newAssigneeId: 'user-uuid-1', newAssigneeName: 'TestUser', lockReleased: false, isDone: false, comment: 'needs rework' },
    });
    const { executeRejectTransition } = await loadRejectKernel();
    const result = await executeRejectTransition({
      requirementId: 'req-uuid-1', fromStep: 'testing', toStep: 'dev_self_check',
      stateVersion: 0, newAssigneeId: 'user-uuid-1', newAssigneeName: 'TestUser',
      comment: 'needs rework', actor: rejectActor, execution: rejectExecution, lockAction: { type: 'none' },
    });
    expect(result.replayed).toBe(true);
  });

  it('reject replay with wrong event type returns 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease(), metadata: {},
    });
    const { executeRejectTransition } = await loadRejectKernel();
    try {
      await executeRejectTransition({
        requirementId: 'req-uuid-1', fromStep: 'testing', toStep: 'dev_self_check',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        comment: 'no', actor: rejectActor, execution: rejectExecution, lockAction: { type: 'none' },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('different operation type');
    }
  });

  it('reject requesterId repair is part of atomic patch', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let updateData: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'testing', stateVersion: 0, assigneeId: 'user-uuid-2' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockImplementation(({ data }: any) => {
            updateData = data;
            return { count: 1 };
          }),
        },
        executionLease: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      return { requirementId: 'req-uuid-1', fromStep: 'testing', toStep: 'draft', newStateVersion: 1, newAssigneeId: 'user-uuid-1', newAssigneeName: 'Requester', replayed: false, lockReleased: false, isDone: false };
    });
    const { executeRejectTransition } = await loadRejectKernel();
    await executeRejectTransition({
      requirementId: 'req-uuid-1', fromStep: 'testing', toStep: 'draft',
      stateVersion: 0, newAssigneeId: 'user-uuid-1', newAssigneeName: 'Requester',
      comment: 'back to draft', actor: rejectActor, lockAction: { type: 'none' },
      requesterId: 'user-uuid-1',
    });
    expect(updateData).not.toBeNull();
    expect(updateData.requesterId).toBe('user-uuid-1');
  });
});

describe('auth agentId', () => {
  it('Express.AuthUser type includes agentId', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../types/express.d.ts', import.meta.url),
      'utf-8',
    );
    expect(content).toContain('agentId');
  });

  it('authRequired selects agentId in all user lookups', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../middleware/auth.ts', import.meta.url),
      'utf-8',
    );
    const agentIdSelects = content.match(/agentId: true/g);
    expect(agentIdSelects).not.toBeNull();
    expect(agentIdSelects!.length).toBe(3);
  });
});

describe('BLOCKER 1: route replay called before requirement lookup', () => {
  it('workflow-advance.ts calls tryReplayAdvance({ before .findUnique({', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/requirements/workflow-advance.ts', import.meta.url),
      'utf-8',
    );
    // Use tryReplayAdvance({ to match call site not import line
    const replayCallPos = content.indexOf('tryReplayAdvance({');
    const findUniquePos = content.indexOf('.findUnique({');
    expect(replayCallPos).not.toBe(-1);
    expect(findUniquePos).not.toBe(-1);
    expect(replayCallPos).toBeLessThan(findUniquePos);
  });

  it('workflow-reject.ts calls tryReplayReject({ before .findUnique({', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/requirements/workflow-reject.ts', import.meta.url),
      'utf-8',
    );
    const replayCallPos = content.indexOf('tryReplayReject({');
    const findUniquePos = content.indexOf('.findUnique({');
    expect(replayCallPos).not.toBe(-1);
    expect(findUniquePos).not.toBe(-1);
    expect(replayCallPos).toBeLessThan(findUniquePos);
  });
});

describe('BLOCKER 2: ownerAgent enforcement', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('advance replay with different ownerAgentId returns 409 (null vs agent)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED',
      lease: mkLease({ ownerAgentId: 'agent-1' }),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing', requestedBranch: null, comment: null },
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const actorNoAgent = { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null };
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor: actorNoAgent, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('ownerAgentId');
    }
  });

  it('advance replay with different ownerAgentId returns 409 (agent vs null)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED',
      lease: mkLease({ ownerAgentId: null }),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing', requestedBranch: null, comment: null },
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const actorWithAgent = { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: 'agent-1' };
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor: actorWithAgent, execution: { ...execution, leaseId: 'lease-uuid-1' }, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('ownerAgentId');
    }
  });

  it('transaction validates ownerAgentId null-safe against actor.agentId within tx', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: { findUnique: vi.fn().mockResolvedValue(mkLease({ ownerAgentId: null })) },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const actorWithAgent = { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: 'agent-1' };
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor: actorWithAgent, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('different agent');
    }
  });
});

describe('BLOCKER 3: version/assignee lease validation', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('proof expectedStateVersion must match lease expectedStateVersion', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 5, assigneeId: 'user-uuid-1' }) },
        executionLease: { findUnique: vi.fn().mockResolvedValue(mkLease({ expectedStateVersion: 5 })) },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    // proof.expectedStateVersion=0 but lease.expectedStateVersion=5
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 5, newAssigneeId: null, newAssigneeName: null,
        actor, execution: { ...execution, expectedStateVersion: 0 }, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('expectedStateVersion');
    }
  });

  it('authoritative stateVersion drifted from lease, preflight stateVersion=0 → handleStaleLease 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleHandlerCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 2, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ expectedStateVersion: 0 })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') { staleHandlerCreated = true; return { count: 1 }; }
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      expect(staleHandlerCreated).toBe(true);
      return { __stale: true, reason: 'requirement stateVersion drifted from lease' };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      // preflight stateVersion=0, but authoritative=2 and lease.expectedStateVersion=0
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('authoritative currentStep drifted from lease, preflight fromStep=dev_self_check → handleStaleLease 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleHandlerCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'testing', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ workflowStep: 'dev_self_check' })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') { staleHandlerCreated = true; return { count: 1 }; }
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      expect(staleHandlerCreated).toBe(true);
      return { __stale: true, reason: 'requirement currentStep drifted from lease' };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      // preflight fromStep=dev_self_check, but authoritative=testing and lease.workflowStep=dev_self_check
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'qa_review',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('authoritative assignee drifted from lease owner, preflight fromStep=dev_self_check → handleStaleLease 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleHandlerCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'other-user' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease()),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') { staleHandlerCreated = true; return { count: 1 }; }
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      expect(staleHandlerCreated).toBe(true);
      return { __stale: true, reason: 'requirement assignee drifted from lease' };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('stale sentinel commits FAILED+INVALIDATED before outer 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let invalidatedEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'testing', stateVersion: 0, assigneeId: 'user-uuid-1' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ workflowStep: 'dev_self_check' })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') return { count: 1 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { invalidatedEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      const result = await cb(tx);
      expect(invalidatedEventCreated).toBe(true);
      return result;
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('bad proof version mismatch alone does not invalidate a valid lease', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let leaseUpdateManyCalled = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: { findUnique: vi.fn().mockResolvedValue(mkLease({ expectedStateVersion: 5 })), updateMany: vi.fn() },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      (tx as any).executionLease.updateMany = vi.fn().mockImplementation(() => { leaseUpdateManyCalled = true; return { count: 1 }; });
      await cb(tx);
      expect(leaseUpdateManyCalled).toBe(false);
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution: { ...execution, expectedStateVersion: 0 }, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });
});

describe('P0-B1 reject: authoritative state drifted from lease → stale sentinel', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const rejectActor = { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null };
  const rejectExecution = { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-reject-1', expectedStateVersion: 0 };

  it('reject: authoritative stateVersion drifted from lease, preflight matches old → stale sentinel', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'testing', stateVersion: 5, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ workflowStep: 'testing', expectedStateVersion: 0 })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE') return { count: 1 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { staleEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      expect(staleEventCreated).toBe(true);
      return { __stale: true, reason: 'requirement stateVersion drifted from lease' };
    });
    const { executeRejectTransition } = await loadRejectKernel();
    try {
      await executeRejectTransition({
        requirementId: 'req-uuid-1', fromStep: 'testing', toStep: 'dev_self_check',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        comment: 'fix', actor: rejectActor, execution: rejectExecution, lockAction: { type: 'none' },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('reject: authoritative currentStep drifted from lease → stale sentinel', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'qa_review', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ workflowStep: 'testing' })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE') return { count: 1 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { staleEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      expect(staleEventCreated).toBe(true);
      return { __stale: true, reason: 'requirement currentStep drifted from lease' };
    });
    const { executeRejectTransition } = await loadRejectKernel();
    try {
      await executeRejectTransition({
        requirementId: 'req-uuid-1', fromStep: 'testing', toStep: 'dev_self_check',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        comment: 'fix', actor: rejectActor, execution: rejectExecution, lockAction: { type: 'none' },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('reject: bad ownerUserId proof does not fail lease (no lease updateMany)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let leaseUpdateManyCalled = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'testing', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ ownerUserId: 'other-owner' })),
          updateMany: vi.fn().mockImplementation(() => { leaseUpdateManyCalled = true; return { count: 1 }; }),
        },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      try { await cb(tx); } catch { /* expected */ }
      expect(leaseUpdateManyCalled).toBe(false);
      return { __stale: true, reason: 'lease owned by different user' };
    });
    const { executeRejectTransition } = await loadRejectKernel();
    try {
      await executeRejectTransition({
        requirementId: 'req-uuid-1', fromStep: 'testing', toStep: 'dev_self_check',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        comment: 'fix', actor: rejectActor, execution: rejectExecution, lockAction: { type: 'none' },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });
});

describe('BLOCKER 4: lease terminalization conditional with full predicate', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('successful terminal update predicate includes all fields and count=1 allows transition', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let terminalWhere: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease()),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            terminalWhere = where;
            return { count: 1 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      expect(terminalWhere).not.toBeNull();
      expect(terminalWhere.id).toBe('lease-uuid-1');
      expect(terminalWhere.requirementId).toBe('req-uuid-1');
      expect(terminalWhere.ownerUserId).toBe('user-uuid-1');
      expect(terminalWhere.sessionId).toBe('session-1');
      expect(terminalWhere.status).toBe('ACTIVE');
      expect(terminalWhere.expiresAt).toBeDefined();
      expect(terminalWhere.expiresAt.gt).toBeDefined();
      expect(terminalWhere.workflowStep).toBe('dev_self_check');
      expect(terminalWhere.expectedStateVersion).toBe(0);
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('terminal update count=0 prevents transition/event/lock commit', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let eventCreateCalled = false;
    let transitionCreateCalled = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease()),
          updateMany: vi.fn().mockReturnValue({ count: 0 }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { eventCreateCalled = true; return {}; }) },
        workflowTransition: { create: vi.fn().mockImplementation(() => { transitionCreateCalled = true; return {}; }) },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      // Transaction should roll back, nothing persisted
      return {};
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('lease terminalization failed');
    }
  });
});

describe('BLOCKER 5: human invalidation includes time-expired ACTIVE', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('human invalidateActiveLease invalidates any ACTIVE regardless of expiresAt', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let invalidateWhere: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: {
          findFirst: vi.fn().mockResolvedValue({ id: 'lease-uuid-1' }),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            invalidateWhere = where;
            return { count: 1 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      await cb(tx);
      expect(invalidateWhere).not.toBeNull();
      expect(invalidateWhere.id).toBe('lease-uuid-1');
      expect(invalidateWhere.status).toBe('ACTIVE');
      // No expiresAt filter - should invalidate even if time-expired
      expect(invalidateWhere.expiresAt).toBeUndefined();
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });
});

describe('BLOCKER 6: lock/result ordering', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('event metadata records actual lockReleased value', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let eventMeta: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'test_env_deploy', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: { findUnique: vi.fn().mockResolvedValue(mkLease({ workflowStep: 'test_env_deploy' })), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn().mockImplementation(({ data }: any) => { eventMeta = data.metadata; return {}; }) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: { findUnique: vi.fn().mockResolvedValue({ requirementId: 'req-uuid-1' }), upsert: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
      };
      await cb(tx);
      return { requirementId: 'req-uuid-1', fromStep: 'test_env_deploy', toStep: 'qa_review', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: true, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'test_env_deploy', toStep: 'qa_review',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'release' }, finalStepName: 'done',
    });
    expect(eventMeta).not.toBeNull();
    expect(eventMeta.lockReleased).toBe(true);
  });

  it('acquire lock uses effective branch (body.branch ?? existing branch)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let lockBranch: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' })
            .mockResolvedValueOnce({ stateVersion: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        executionLease: { findUnique: vi.fn().mockResolvedValue(mkLease()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        testEnvLock: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockImplementation((args: any) => { lockBranch = args.create?.branch ?? args.update?.branch; return {}; }),
          delete: vi.fn(),
        },
      };
      await cb(tx);
      return { requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'test_env_deploy', newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, replayed: false, lockReleased: false, isDone: false };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'test_env_deploy',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, effectiveBranch: 'my-feature-branch', lockAction: { type: 'acquire', title: 'Test', branch: 'my-feature-branch' }, finalStepName: 'done',
    });
    expect(lockBranch).toBe('my-feature-branch');
  });
});

describe('BLOCKER 7: concurrency', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('P2002 with exact committed replay succeeds', async () => {
    mockPrisma.executionLeaseEvent.findUnique
      .mockResolvedValueOnce(null) // first attempt from tryReplayAdvanceByKey
      .mockResolvedValueOnce({    // P2002 retry replay
        id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
        metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing', requestedBranch: null, comment: null, newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, lockReleased: false, isDone: false },
      });
    mockPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const result = await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(result.replayed).toBe(true);
  });

  it('P2002 with no matching event gives 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique
      .mockResolvedValueOnce(null) // first attempt
      .mockResolvedValueOnce(null); // P2002 retry - no event found
    mockPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });
});

describe('BLOCKER 8: early replay helpers (transition-replay.ts)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('tryReplayAdvance validates cross-requirement early replay 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED',
      lease: mkLease({ requirementId: 'other-req' }),
      metadata: {},
    });
    const { tryReplayAdvance } = await import('../lib/workflow-transition/transition-replay.js');
    try {
      await tryReplayAdvance({
        requirementId: 'req-uuid-1',
        actor: { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null },
        execution: { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-1', expectedStateVersion: 0 },
        requestedBranch: undefined,
        comment: undefined,
        fromStep: 'dev_self_check',
        toStep: 'testing',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('tryReplayAdvance validates cross-session early replay 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED',
      lease: mkLease({ sessionId: 'other-session' }),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing', requestedBranch: null, comment: null },
    });
    const { tryReplayAdvance } = await import('../lib/workflow-transition/transition-replay.js');
    try {
      await tryReplayAdvance({
        requirementId: 'req-uuid-1',
        actor: { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null },
        execution: { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-1', expectedStateVersion: 0 },
        requestedBranch: undefined,
        comment: undefined,
        fromStep: 'dev_self_check',
        toStep: 'testing',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('tryReplayAdvance validates cross-branch early replay 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED',
      lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing', requestedBranch: 'main', comment: null },
    });
    const { tryReplayAdvance } = await import('../lib/workflow-transition/transition-replay.js');
    try {
      await tryReplayAdvance({
        requirementId: 'req-uuid-1',
        actor: { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null },
        execution: { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-1', expectedStateVersion: 0 },
        requestedBranch: 'develop',
        comment: undefined,
        fromStep: 'dev_self_check',
        toStep: 'testing',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('tryReplayAdvance exact match returns replayed result', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED',
      lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing', requestedBranch: null, comment: null, newStateVersion: 1, newAssigneeId: null, newAssigneeName: null, lockReleased: false, isDone: false },
    });
    const { tryReplayAdvance } = await import('../lib/workflow-transition/transition-replay.js');
    const result = await tryReplayAdvance({
      requirementId: 'req-uuid-1',
      actor: { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null },
      execution: { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-1', expectedStateVersion: 0 },
      requestedBranch: undefined,
      comment: undefined,
      fromStep: 'dev_self_check',
      toStep: 'testing',
    });
    expect(result).not.toBeNull();
    expect(result!.replayed).toBe(true);
    expect(result!.toStep).toBe('testing');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('BLOCKER 9: execution-lease ownerAgent tests', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('claim persists ownerAgentId in lease and event metadata', async () => {
    const { claimExecutionLease } = await import('../lib/execution-lease/index.js');
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let createdLeaseData: any = null;
    let createdEventData: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => {
            createdLeaseData = data;
            return mkLease({ ownerAgentId: 'agent-1', claimKey: 'fresh-key', id: 'new-lease' });
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(({ data }: any) => { createdEventData = data; return {}; }) },
      };
      return cb(tx);
    });
    await claimExecutionLease('req-uuid-1', 'user-uuid-1', 'agent-1', {
      idempotencyKey: 'fresh-key', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600,
    });
    expect(createdLeaseData.ownerAgentId).toBe('agent-1');
    expect(createdEventData.metadata.ownerAgentId).toBe('agent-1');
  });

  it('claim replay with null-safe ownerAgentId mismatch returns 409', async () => {
    const { claimExecutionLease } = await import('../lib/execution-lease/index.js');
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'CLAIMED',
      lease: mkLease({ ownerAgentId: 'agent-1' }),
      metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 0, ttl: 3600 },
    });
    try {
      await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('ownerAgentId');
    }
  });
});

describe('P0-B1: kernel-level branch replay with requestedBranch=null', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('initial tryReplayAdvanceByKey succeeds when meta.requestedBranch=null and params.requestedBranch=undefined', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing',
        toStepDisplayName: '测试', requestedBranch: null, effectiveBranch: 'main',
        newStateVersion: 1, newAssigneeId: null, newAssigneeName: null,
        lockReleased: false, isDone: false, comment: null },
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const result = await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      effectiveBranch: 'main', requestedBranch: undefined,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(result.replayed).toBe(true);
  });

  it('P2002 conflict retry succeeds when meta.requestedBranch=null and params.requestedBranch=undefined', async () => {
    mockPrisma.executionLeaseEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
        metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing',
          toStepDisplayName: '测试', requestedBranch: null, effectiveBranch: 'main',
          newStateVersion: 1, newAssigneeId: null, newAssigneeName: null,
          lockReleased: false, isDone: false, comment: null },
      });
    mockPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const result = await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      effectiveBranch: 'main', requestedBranch: undefined,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(result.replayed).toBe(true);
  });

  it('P2034 conflict retry succeeds when meta.requestedBranch=null and params.requestedBranch=undefined', async () => {
    mockPrisma.executionLeaseEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
        metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing',
          toStepDisplayName: '测试', requestedBranch: null, effectiveBranch: 'main',
          newStateVersion: 1, newAssigneeId: null, newAssigneeName: null,
          lockReleased: false, isDone: false, comment: null },
      });
    mockPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error('Serialization failure'), { code: 'P2034' }),
    );
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const result = await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      effectiveBranch: 'main', requestedBranch: undefined,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(result.replayed).toBe(true);
  });
});

describe('P0-B1: advance already committed, same request retry replays successfully', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('kernel replays even when fromStep would mismatch because requirement already advanced', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing',
        toStepDisplayName: '测试', requestedBranch: null, effectiveBranch: null,
        newStateVersion: 1, newAssigneeId: null, newAssigneeName: null,
        lockReleased: false, isDone: false, comment: null },
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    const result = await executeAdvanceTransition({
      requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
      stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
      actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
    });
    expect(result.replayed).toBe(true);
    expect(result.toStepDisplayName).toBe('测试');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('P0-B1: advance omits branch, requirement has branch, retry succeeds', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('tryReplayAdvance with requestedBranch=null matches meta.requestedBranch=null', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing',
        toStepDisplayName: '测试', requestedBranch: null, effectiveBranch: 'main',
        newStateVersion: 1, newAssigneeId: null, newAssigneeName: null,
        lockReleased: false, isDone: false, comment: null },
    });
    const { tryReplayAdvance } = await import('../lib/workflow-transition/transition-replay.js');
    const result = await tryReplayAdvance({
      requirementId: 'req-uuid-1',
      actor: { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null },
      execution: { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-1', expectedStateVersion: 0 },
      requestedBranch: undefined,
      comment: undefined,
      fromStep: 'dev_self_check',
      toStep: 'testing',
    });
    expect(result).not.toBeNull();
    expect(result!.replayed).toBe(true);
  });

  it('tryReplayAdvance with requestedBranch=null matches even when meta.effectiveBranch is set', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'ADVANCED', lease: mkLease(),
      metadata: { expectedStateVersion: 0, fromStep: 'dev_self_check', toStep: 'testing',
        toStepDisplayName: '测试', requestedBranch: null, effectiveBranch: 'feature-x',
        newStateVersion: 1, newAssigneeId: null, newAssigneeName: null,
        lockReleased: false, isDone: false, comment: null },
    });
    const { tryReplayAdvance } = await import('../lib/workflow-transition/transition-replay.js');
    const result = await tryReplayAdvance({
      requirementId: 'req-uuid-1',
      actor: { id: 'user-uuid-1', name: 'TestUser', role: 'developer', agentId: null },
      execution: { leaseId: 'lease-uuid-1', sessionId: 'session-1', idempotencyKey: 'ik-1', expectedStateVersion: 0 },
      requestedBranch: undefined,
      comment: undefined,
      fromStep: 'dev_self_check',
      toStep: 'testing',
    });
    expect(result).not.toBeNull();
    expect(result!.replayed).toBe(true);
  });
});

describe('P0-B1: requirement drift causes stale sentinel with handleStaleLease', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('requirement stateVersion drifted from lease → handleStaleLease + stale sentinel', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 5, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ expectedStateVersion: 0 })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') return { count: 1 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { staleEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      const result = await cb(tx);
      expect(staleEventCreated).toBe(true);
      return result;
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 5, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('requirement currentStep drifted from lease → handleStaleLease + stale sentinel', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'testing', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ workflowStep: 'dev_self_check' })),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') return { count: 1 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { staleEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      const result = await cb(tx);
      expect(staleEventCreated).toBe(true);
      return result;
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('requirement assignee drifted from lease owner → handleStaleLease + stale sentinel', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let staleEventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'other-user' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease()),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'ACTIVE' && where.id === 'lease-uuid-1') return { count: 1 };
            return { count: 0 };
          }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { staleEventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      const result = await cb(tx);
      expect(staleEventCreated).toBe(true);
      return result;
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('bad ownerUserId proof does not fail lease (no lease updateMany)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let leaseUpdateManyCalled = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ ownerUserId: 'other-owner' })),
          updateMany: vi.fn().mockImplementation(() => { leaseUpdateManyCalled = true; return { count: 1 }; }),
        },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      try { await cb(tx); } catch { /* expected */ }
      expect(leaseUpdateManyCalled).toBe(false);
      return { __stale: true, reason: 'lease owned by different user' };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution: { ...execution, leaseId: 'lease-uuid-1' }, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('bad sessionId proof does not fail lease (no lease updateMany)', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let leaseUpdateManyCalled = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ sessionId: 'other-session' })),
          updateMany: vi.fn().mockImplementation(() => { leaseUpdateManyCalled = true; return { count: 1 }; }),
        },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      try { await cb(tx); } catch { /* expected */ }
      expect(leaseUpdateManyCalled).toBe(false);
      return { __stale: true, reason: 'session mismatch' };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });
});

describe('P0-B1: failed atomic update leaves no lease terminal/event/lock', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('updateMany count=0 prevents lease terminalization and event', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let leaseUpdateManyCount = 0;
    let eventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease()),
          updateMany: vi.fn().mockImplementation(() => { leaseUpdateManyCount++; return { count: 1 }; }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { eventCreated = true; return {}; }) },
        workflowTransition: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      };
      try { await cb(tx); } catch { /* expected */ }
      expect(eventCreated).toBe(false);
      expect(leaseUpdateManyCount).toBe(0);
      return { __expired: true, reason: 'concurrent modification' };
    });
    const { executeAdvanceTransition } = await loadAdvanceKernel();
    try {
      await executeAdvanceTransition({
        requirementId: 'req-uuid-1', fromStep: 'dev_self_check', toStep: 'testing',
        stateVersion: 0, newAssigneeId: null, newAssigneeName: null,
        actor, execution, lockAction: { type: 'none' }, finalStepName: 'done',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });
});

describe('P0-B2a: admin transition kernel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('CAS with preflight expectedStateVersion + stateVersion+1 + transition + lease invalidation', async () => {
    let capturedTx: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'r1', currentStep: 'draft', stateVersion: 2, assigneeId: 'u1' })
            .mockResolvedValue({ id: 'r1', currentStep: 'abandoned', stateVersion: 3, assigneeId: null }),
          updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
            expect(where.stateVersion).toBe(1);
            expect(data.stateVersion).toEqual({ increment: 1 });
            return { count: 1 };
          }),
        },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        executionLease: { findFirst: vi.fn().mockResolvedValue({ id: 'l1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      capturedTx = tx;
      return cb(tx);
    });
    const { executeAdminTransition } = await import('../lib/workflow-transition/transition-admin.js');
    const result = await executeAdminTransition({
      requirementId: 'r1', fromStep: 'draft', toStep: 'abandoned',
      expectedStateVersion: 1, action: 'abandon', actorId: 'u1', actorName: 'User', actorRole: 'developer',
    });
    expect(result.newStateVersion).toBe(2);
    expect(capturedTx.workflowTransition.create).toHaveBeenCalled();
    expect(capturedTx.executionLease.findFirst).toHaveBeenCalled();
  });

  it('authoritative stateVersion=2 but preflight expectedVersion=1 → CAS=0, no artifacts', async () => {
    let capturedWhereStateVersion: number | undefined;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'r1', currentStep: 'draft', stateVersion: 2, assigneeId: 'u1' })
            .mockResolvedValueOnce({ id: 'r1' }),
          updateMany: vi.fn().mockImplementation(({ where }: any) => {
            capturedWhereStateVersion = where.stateVersion;
            return { count: 0 };
          }),
        },
        executionLease: { findFirst: vi.fn(), updateMany: vi.fn() },
        executionLeaseEvent: { create: vi.fn() },
        workflowTransition: { create: vi.fn() },
      };
      try {
        return await cb(tx);
      } catch {
        // cb threw — let it propagate through $transaction reject
        throw new HttpError(409, 'concurrent modification: requirement state changed');
      }
    });
    const { executeAdminTransition } = await import('../lib/workflow-transition/transition-admin.js');
    try {
      await executeAdminTransition({
        requirementId: 'r1', fromStep: 'draft', toStep: 'abandoned',
        expectedStateVersion: 1, action: 'abandon', actorId: 'u1', actorName: 'User', actorRole: 'developer',
      });
      expect.unreachable();
    } catch (e) {
      // New correct impl: CAS uses preflight expectedStateVersion=1, not authoritative version=2
      // If old wrong impl used authoritative version=2, CAS would have succeeded (count=1) ← wrong
      expect(capturedWhereStateVersion).toBe(1);
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('admin kernel metadata uses Prisma.InputJsonValue not as any', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../lib/workflow-transition/transition-admin.ts', import.meta.url),
      'utf-8',
    );
    expect(content).toContain('Prisma.InputJsonValue');
    expect(content).not.toContain('as any');
    expect(content).not.toContain('extraFields');
    expect(content).toContain('expectedStateVersion');
    expect(content).toContain('rejectReason');
  });

  it('generic PATCH body.currentStep returns 400', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/requirements/core-patch.ts', import.meta.url),
      'utf-8',
    );
    expect(content).toMatch(/currentStep[\s\S]*status[\s\S]*400/);
    expect(content).not.toContain('currentStep: existing.currentStep');
    // PATCH should not call executeAdminTransition (uses prisma.requirement.update)
    expect(content).toContain('prisma.requirement.update');
    expect(content).not.toContain('executeAdminTransition');
  });

  it('PATCH handler throws 400 without touching DB when currentStep sent', async () => {
    const { registerCorePatchRoutes } = await import('../routes/requirements/core-patch.js');
    const router = { patch: vi.fn() } as any;
    registerCorePatchRoutes(router);
    const handler = router.patch.mock.calls[0][1]; // asyncHandler-wrapped handler
    const req = {
      params: { id: '00000000-0000-0000-0000-000000000001' },
      body: { currentStep: 'testing' },
      user: { id: 'u1', name: 'T', role: 'developer' },
    };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await handler(req, res, next);
    // asyncHandler catches 400 and passes to next
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeDefined();
    expect((err as any).statusCode).toBe(400);
    // DB should not have been called
    expect(mockPrisma.requirement.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.requirement.update).not.toHaveBeenCalled();
  });

  it('routes pass expectedStateVersion to admin kernel', async () => {
    const fs = await import('fs');
    const files = [
      'routes/requirements/core-lifecycle.ts',
      'routes/requirements/workflow-lifecycle.ts',
      'routes/requirements/review.ts',
    ];
    const base = new URL('..', import.meta.url);
    for (const f of files) {
      const content = fs.readFileSync(new URL(f, base), 'utf-8');
      expect(content).toContain('expectedStateVersion:');
    }
  });
});

describe('P0-B2a: workflow assign transaction kernel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('old currentStep=null, preflight version=3, CAS where:null + version=3, data has workflow+snapshot+assignee+increment', async () => {
    let capturedTx: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'r1' }),
          updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
            expect(where.currentStep).toBeNull();
            expect(where.stateVersion).toBe(3);
            expect(data.workflowId).toBe('tmpl-1');
            expect(data.workflowSnapshot).toBeDefined();
            expect(data.currentStep).toBe('dev_self_check');
            expect(data.assigneeId).toBe('u2');
            expect(data.stateVersion).toEqual({ increment: 1 });
            return { count: 1 };
          }),
        },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        executionLease: { findFirst: vi.fn().mockResolvedValue({ id: 'l1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      capturedTx = tx;
      return cb(tx);
    });
    const { executeAssignTransition } = await import('../lib/workflow-transition/transition-assign.js');
    const result = await executeAssignTransition({
      requirementId: 'r1',
      fromStep: null,
      toStep: 'dev_self_check',
      toStepDisplayName: '开发自检',
      expectedStateVersion: 3,
      workflowId: 'tmpl-1',
      workflowName: 'Standard',
      workflowDisplayName: '标准工作流',
      workflowSnapshot: ['step1'] as any,
      assigneeId: 'u2',
      actorId: 'u1', actorName: 'Admin', actorRole: 'admin',
      steps: [{ name: 'dev_self_check', displayName: '开发自检', role: 'developer' }],
    });
    expect(result.stateVersion).toBe(4);
    expect(capturedTx.workflowTransition.create).toHaveBeenCalled();
    expect(capturedTx.executionLease.findFirst).toHaveBeenCalled();
    expect(capturedTx.executionLease.updateMany).toHaveBeenCalled();
  });

  it('updateMany count=0 prevents transition, lease, and event', async () => {
    let capturedTx: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({ id: 'r1' })
            .mockResolvedValueOnce({ id: 'r1' }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        workflowTransition: { create: vi.fn() },
        executionLease: { findFirst: vi.fn(), updateMany: vi.fn() },
        executionLeaseEvent: { create: vi.fn() },
      };
      capturedTx = tx;
      return cb(tx);
    });
    const { executeAssignTransition } = await import('../lib/workflow-transition/transition-assign.js');
    try {
      await executeAssignTransition({
        requirementId: 'r1',
        fromStep: 'draft',
        toStep: 'dev_self_check',
        toStepDisplayName: '开发自检',
        expectedStateVersion: 3,
        workflowId: 'tmpl-1',
        workflowName: 'Standard',
        workflowDisplayName: '标准工作流',
        workflowSnapshot: ['step1'] as any,
        assigneeId: 'u2',
        actorId: 'u1', actorName: 'Admin', actorRole: 'admin',
        steps: [{ name: 'dev_self_check', displayName: '开发自检', role: 'developer' }],
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      // count=0 means CAS failed — no transition, lease, or event should survive
      expect(capturedTx.workflowTransition.create).not.toHaveBeenCalled();
      expect(capturedTx.executionLease.findFirst).not.toHaveBeenCalled();
      expect(capturedTx.executionLease.updateMany).not.toHaveBeenCalled();
      expect(capturedTx.executionLeaseEvent.create).not.toHaveBeenCalled();
    }
  });
});

describe('P0-B2b: report review atomic service', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('QA rejected: report CAS + requirement transition in single tx, no revision', async () => {
    mockPrisma.requirementReport.findUnique = vi.fn().mockResolvedValue({
      id: 'r1', status: 'pending', reportType: 'TEST_REPORT', requirementId: 'req-1',
    });
    mockPrisma.requirement.findUnique = vi.fn().mockResolvedValue({
      id: 'req-1', title: 'Test', currentStep: 'qa_review', stateVersion: 3,
      workflowId: 'w1', workflowSnapshot: [], assigneeId: 'u1', assignee: 'Dev',
      workflow: { steps: [] },
    });
    let capturedTx: any = null;
    let reportUpdatedOutsideTx = false;
    // Mock the outer updateMany to track if service writes report BEFORE transaction
    mockPrisma.requirementReport.updateMany = vi.fn().mockImplementation(() => { reportUpdatedOutsideTx = true; return { count: 1 }; });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirementReport: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 'r1', status: 'rejected', reportType: 'TEST_REPORT', requirementId: 'req-1' }),
        },
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-1', currentStep: 'qa_review', stateVersion: 3, assigneeId: 'u1' }),
          updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
            expect(where.stateVersion).toBe(3);
            expect(data.stateVersion).toEqual({ increment: 1 });
            return { count: 1 };
          }),
        },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        executionLease: { findFirst: vi.fn().mockResolvedValue({ id: 'l1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn() },
        requirementRevision: { create: vi.fn().mockResolvedValue({}) },
        user: { findUnique: vi.fn().mockResolvedValue({ name: 'Dev' }) },
      };
      capturedTx = tx;
      return cb(tx);
    });
    const { executeReportReviewQa } = await import('../routes/requirements/report-review-service.js');
    await executeReportReviewQa({
      reportId: 'r1', requirementId: 'req-1',
      status: 'rejected', reviewedAt: new Date(),
      qaReviewedAt: new Date(), qaReviewedBy: 'QA',
      reviewerId: 'qa-1', reviewerName: 'QA', reviewerRole: 'qa',
    });
    // Report update happened INSIDE transaction, not outside
    expect(reportUpdatedOutsideTx).toBe(false);
    expect(capturedTx.requirementReport.updateMany).toHaveBeenCalled();
    expect(capturedTx.workflowTransition.create).toHaveBeenCalled();
    expect(capturedTx.executionLease.findFirst).toHaveBeenCalled();
    expect(capturedTx.executionLease.updateMany).toHaveBeenCalled();
    // QA reject should NOT create revision
    expect(capturedTx.requirementRevision.create).not.toHaveBeenCalled();
  });

  it('final rejected: preflight resolved assignee + revision created in tx', async () => {
    mockPrisma.requirementReport.findUnique = vi.fn().mockResolvedValue({
      id: 'r1', status: 'pending', reportType: 'CTO_REVIEW', requirementId: 'req-1',
    });
    mockPrisma.requirement.findUnique = vi.fn().mockResolvedValue({
      id: 'req-1', title: 'Test', currentStep: 'cto_review', stateVersion: 1,
      workflowId: 'w1', workflowSnapshot: [], assigneeId: 'u2', assignee: 'Dev2',
      workflow: { steps: [] },
    });
    mockPrisma.requirementReport.updateMany = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirementReport: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 'r1', status: 'rejected', reportType: 'CTO_REVIEW', requirementId: 'req-1' }),
        },
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-1', currentStep: 'cto_review', stateVersion: 1, assigneeId: 'u2' }),
          updateMany: vi.fn().mockReturnValue({ count: 1 }),
        },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        executionLease: { findFirst: vi.fn().mockResolvedValue({ id: 'l1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn() },
        requirementRevision: { create: vi.fn().mockResolvedValue({}) },
        user: { findUnique: vi.fn().mockResolvedValue({ name: 'Dev2' }) },
      };
      return cb(tx);
    });
    const { executeReportReviewFinal } = await import('../routes/requirements/report-review-service.js');
    const result = await executeReportReviewFinal({
      reportId: 'r1', requirementId: 'req-1',
      status: 'rejected', reviewedAt: new Date(),
      reviewerId: 'cto-1', reviewerName: 'CTO', reviewerRole: 'admin',
      createRevision: true,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(result.status).toBe('rejected');
  });

  it('final rejected: revision assignee exists but user not found falls back to currentAssigneeId', async () => {
    mockPrisma.requirementReport.findUnique = vi.fn().mockResolvedValue({
      id: 'r1', status: 'pending', reportType: 'CTO_REVIEW', requirementId: 'req-1',
    });
    mockPrisma.requirement.findUnique = vi.fn().mockResolvedValue({
      id: 'req-1', title: 'Test', currentStep: 'cto_review', stateVersion: 1,
      workflowId: 'w1', workflowSnapshot: [], assigneeId: 'current-uuid',
      assignee: 'CurrentUser',
      workflow: { steps: [] },
    });
    mockPrisma.requirementReport.updateMany = vi.fn();
    mockPrisma.requirementRevision.findFirst = vi.fn().mockResolvedValue({ assignee: 'OldDev' });
    mockPrisma.user.findFirst = vi.fn().mockResolvedValue(null); // user not found
    let capturedTx: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirementReport: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 'r1', status: 'rejected', reportType: 'CTO_REVIEW', requirementId: 'req-1' }),
        },
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-1', currentStep: 'cto_review', stateVersion: 1, assigneeId: 'current-uuid' }),
          updateMany: vi.fn().mockReturnValue({ count: 1 }),
        },
        workflowTransition: { create: vi.fn().mockResolvedValue({}) },
        executionLease: { findFirst: vi.fn().mockResolvedValue({ id: 'l1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        executionLeaseEvent: { create: vi.fn() },
        requirementRevision: { create: vi.fn().mockResolvedValue({}) },
        user: { findUnique: vi.fn().mockResolvedValue({ name: 'CurrentUser' }) },
      };
      capturedTx = tx;
      return cb(tx);
    });
    const { executeReportReviewFinal } = await import('../routes/requirements/report-review-service.js');
    const result = await executeReportReviewFinal({
      reportId: 'r1', requirementId: 'req-1',
      status: 'rejected', reviewedAt: new Date(),
      reviewerId: 'cto-1', reviewerName: 'CTO', reviewerRole: 'admin',
      createRevision: true,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(result.status).toBe('rejected');
    expect(capturedTx.requirementRevision.create).toHaveBeenCalled();
    const revData = capturedTx.requirementRevision.create.mock.calls[0][0].data;
    expect(revData.assignee).toBe('OldDev');
  });

  it('report CAS count=0 returns 409, no requirement/transition/lease/revision touch', async () => {
    mockPrisma.requirementReport.findUnique = vi.fn().mockResolvedValue({
      id: 'r1', status: 'pending', reportType: 'TEST_REPORT', requirementId: 'req-1',
    });
    mockPrisma.requirement.findUnique = vi.fn().mockResolvedValue({
      id: 'req-1', title: 'Test', currentStep: 'qa_review', stateVersion: 3,
      workflowId: 'w1', workflowSnapshot: [], assigneeId: 'u1', assignee: 'Dev',
      workflow: { steps: [] },
    });
    let transitionCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirementReport: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req-1', currentStep: 'qa_review', stateVersion: 3, assigneeId: 'u1' }),
          updateMany: vi.fn(),
        },
        workflowTransition: { create: vi.fn().mockImplementation(() => { transitionCreated = true; return {}; }) },
        executionLease: { findFirst: vi.fn(), updateMany: vi.fn() },
        executionLeaseEvent: { create: vi.fn() },
        requirementRevision: { create: vi.fn() },
        user: { findUnique: vi.fn() },
      };
      try { await cb(tx); } catch { /* expected 409 */ }
      expect(transitionCreated).toBe(false);
      expect(tx.workflowTransition.create).not.toHaveBeenCalled();
      expect(tx.requirementRevision.create).not.toHaveBeenCalled();
      throw new HttpError(409, 'concurrent report modification');
    });
    const { executeReportReviewQa } = await import('../routes/requirements/report-review-service.js');
    try {
      await executeReportReviewQa({
        reportId: 'r1', requirementId: 'req-1',
        status: 'rejected', reviewedAt: new Date(),
        qaReviewedAt: new Date(), qaReviewedBy: 'QA',
        reviewerId: 'qa-1', reviewerName: 'QA', reviewerRole: 'qa',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
    }
  });

  it('reports.ts QA handler does not directly update report (all through service)', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/reports.ts', import.meta.url),
      'utf-8',
    );
    // QA review section should use executeReportReviewQa
    const qaSection = content.slice(content.indexOf('qa-review'), content.indexOf('CTO 最终审批'));
    expect(qaSection).toContain('executeReportReviewQa');
    expect(qaSection).not.toContain('requirementReport.update({'); // no direct update
    expect(qaSection).not.toContain('executeReportReviewAtomic'); // old name gone
  });

  it('reports.ts final handler does not directly update report (all through service)', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/reports.ts', import.meta.url),
      'utf-8',
    );
    // The final handler is the one that contains executeReportReviewFinal
    const finalSection = content.slice(content.indexOf('executeReportReviewFinal') - 200, content.indexOf('executeReportReviewFinal') + 500);
    expect(finalSection).toContain('executeReportReviewFinal');
    // Should not have a direct .update({ call within the final handler
    expect(finalSection).not.toMatch(/\.update\(\s*\{/);
  });
});

describe('P0-B2b: task routes no longer touch requirement', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('task POST does NOT call requirement.update or updateMany', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/tasks.ts', import.meta.url),
      'utf-8',
    );
    const postSection = content.slice(content.indexOf('tasksRouter.post'), content.indexOf('tasksRouter.get'));
    expect(postSection).not.toContain('requirement.update');
    expect(postSection).not.toContain('$transaction');
  });

  it('task PATCH does NOT call requirement.update or updateMany for status changes', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/tasks.ts', import.meta.url),
      'utf-8',
    );
    const patchSection = content.slice(content.indexOf('tasksRouter.patch'), content.indexOf('tasksRouter.delete') > 0 ? content.indexOf('tasksRouter.delete') : content.length);
    expect(patchSection).not.toContain('requirement.update');
    expect(patchSection).not.toContain('$transaction');
    expect(patchSection).toContain('task.update');
    expect(patchSection).toContain('prismaTaskStatus');
  });
});

describe('P0-B2b: static inventory - active routes currentStep writes', () => {
  it('reports.ts no longer has direct prisma.requirement.update currentStep writes', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/reports.ts', import.meta.url),
      'utf-8',
    );
    expect(content).toContain('executeReportReviewQa');
    expect(content).toContain('executeReportReviewFinal');
    expect(content).not.toContain('executeReportReviewAtomic');
    expect(content).not.toMatch(/data:\s*\{\s*currentStep:/);
  });

  it('tasks.ts no longer has direct prisma.requirement.update currentStep writes', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../routes/tasks.ts', import.meta.url),
      'utf-8',
    );
    expect(content).not.toContain('requirement.update');
    // currentStep should only appear in read contexts (select/GET response), not in write data
    expect(content).not.toMatch(/data:\s*\{[^}]*currentStep/);
  });
});

describe('no forbidden APIs', () => {
  it('does not import child_process/execSync/git/filesystem/worktree/deploy in transition modules', async () => {
    const fs = await import('fs');
    const files = [
      'transition-advance.ts', 'transition-reject.ts',
      'transition-utils.ts', 'transition-types.ts', 'index.ts',
    ];
    for (const file of files) {
      const content = fs.readFileSync(
        new URL(`../lib/workflow-transition/${file}`, import.meta.url),
        'utf-8',
      );
      expect(content).not.toContain('child_process');
      expect(content).not.toContain('execSync');
      expect(content).not.toContain('node:fs');
      expect(content).not.toContain('require(');
    }
  });
});

describe('module line limits', () => {
  it('all workflow-transition production modules are <= 220 lines', async () => {
    const fs = await import('fs');
    const files = [
      'transition-advance.ts', 'transition-reject.ts',
      'transition-utils.ts', 'transition-types.ts', 'transition-replay.ts', 'index.ts',
    ];
    for (const file of files) {
      const content = fs.readFileSync(
        new URL(`../lib/workflow-transition/${file}`, import.meta.url),
        'utf-8',
      );
      const lines = content.split('\n').length;
      expect(lines).toBeLessThanOrEqual(220);
    }
  });

  it('refactored advance/reject route files are <= 220 lines', async () => {
    const fs = await import('fs');
    const files = ['workflow-advance.ts', 'workflow-reject.ts'];
    for (const file of files) {
      const content = fs.readFileSync(
        new URL(`../routes/requirements/${file}`, import.meta.url),
        'utf-8',
      );
      const lines = content.split('\n').length;
      expect(lines).toBeLessThanOrEqual(220);
    }
  });
});
