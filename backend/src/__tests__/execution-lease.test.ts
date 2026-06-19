import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '../utils/http-error.js';

const mockPrisma = {
  requirement: { findUnique: vi.fn(), update: vi.fn() },
  executionLease: {
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  },
  executionLeaseEvent: { findUnique: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }));

const mkLease = (overrides: Record<string, unknown> = {}) => ({
  id: 'lease-uuid-1',
  requirementId: 'req-uuid-1',
  workflowStep: 'dev_self_check',
  expectedStateVersion: 0,
  ownerUserId: 'user-uuid-1',
  ownerAgentId: null,
  sessionId: 'session-1',
  claimKey: 'k1',
  status: 'ACTIVE',
  acquiredAt: new Date(),
  heartbeatAt: new Date(),
  expiresAt: new Date(Date.now() + 3600_000),
  releasedAt: null, releaseReason: null,
  worktreePath: null, gitBranch: null,
  createdAt: new Date(), updatedAt: new Date(),
  requirement: { currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1', repoPath: '/main/repo' },
  owner: { id: 'user-uuid-1', name: 'TestUser', email: 'test@example.com' },
  ...overrides,
});

async function loadSvc() {
  return import('../lib/execution-lease/index.js');
}

describe('execution-lease-service', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('claimExecutionLease', () => {
    it('replays before checking requirement state when idempotencyKey exists', async () => {
      const existingLease = mkLease();
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: existingLease, metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 0, ttl: 3600 } });
      mockPrisma.requirement.findUnique = vi.fn().mockRejectedValue(new Error('should not be called'));
      const { claimExecutionLease } = await loadSvc();
      const result = await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect(result.replayed).toBe(true);
    });

    it('reads and validates requirement inside the Serializable transaction', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      let requirementReadInsideTx = false;
      mockPrisma.$transaction.mockImplementation(async (cb: any, opts?: any) => {
        expect(opts?.isolationLevel).toBeDefined();
        const tx = {
          requirement: {
            findUnique: vi.fn().mockImplementation(() => {
              requirementReadInsideTx = true;
              return { id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' };
            }),
          },
          executionLease: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(mkLease({ claimKey: 'fresh-key', id: 'new-lease' })),
          },
          executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        };
        const result = await cb(tx);
        expect(requirementReadInsideTx).toBe(true);
        return result;
      });
      const { claimExecutionLease } = await loadSvc();
      const result = await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'fresh-key', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600,
      });
      expect(result.replayed).toBe(false);
    });

    it('throws HttpError 404 if requirement not found', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          requirement: { findUnique: vi.fn().mockResolvedValue(null) },
          executionLease: { findMany: vi.fn().mockResolvedValue([]) },
        };
        return cb(tx);
      });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600,
        });
        expect.unreachable('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).statusCode).toBe(404);
      }
    });

    it('throws HttpError 409 if terminal state', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', currentStep: 'done', stateVersion: 0, assigneeId: 'u1' }) },
          executionLease: { findMany: vi.fn().mockResolvedValue([]) },
        };
        return cb(tx);
      });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('r1', 'u1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });

    it('throws HttpError 409 if step mismatch', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', currentStep: 'testing', stateVersion: 0, assigneeId: 'u1' }) },
          executionLease: { findMany: vi.fn().mockResolvedValue([]) },
        };
        return cb(tx);
      });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('r1', 'u1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });

    it('throws HttpError 409 if stateVersion mismatch', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', currentStep: 'dev_self_check', stateVersion: 1, assigneeId: 'u1' }) },
          executionLease: { findMany: vi.fn().mockResolvedValue([]) },
        };
        return cb(tx);
      });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('r1', 'u1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });

    it('throws HttpError 403 if not the current assignee', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'other-user' }) },
          executionLease: { findMany: vi.fn().mockResolvedValue([]) },
        };
        return cb(tx);
      });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('r1', 'u1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(403);
      }
    });

    it('replays with exact expectedStep mismatch -> 409', async () => {
      const existingLease = mkLease();
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: existingLease, metadata: { expectedStep: 'testing', expectedStateVersion: 0, ttl: 3600 } });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('expectedStep');
      }
    });

    it('replays with exact stateVersion mismatch -> 409', async () => {
      const existingLease = mkLease();
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: existingLease, metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 5, ttl: 3600 } });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('expectedStateVersion');
      }
    });

    it('replays with exact ttl mismatch -> 409', async () => {
      const existingLease = mkLease();
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: existingLease, metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 0, ttl: 7200 } });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('ttl');
      }
    });

    it('replays with different operation type -> 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'RENEWED', lease: mkLease() });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });

    it('replays with different requirement -> 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: mkLease({ requirementId: 'other-req' }) });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });

    it('replays with different actor -> 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: mkLease({ ownerUserId: 'other-user' }) });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });

    it('replays with different session -> 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: mkLease({ sessionId: 'other-session' }) });
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });

    it('returns replayed=true on exact match', async () => {
      const existingLease = mkLease();
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'CLAIMED', lease: existingLease, metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 0, ttl: 3600 } });
      const { claimExecutionLease } = await loadSvc();
      const result = await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect(result.replayed).toBe(true);
      expect(result.lease.id).toBe('lease-uuid-1');
    });

    it('creates lease and CLAIMED event in serializable transaction', async () => {
      const expectedLease = mkLease({ claimKey: 'fresh-key', id: 'new-lease' });
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any, opts?: any) => {
        expect(opts.isolationLevel).toBeDefined();
        const tx = {
          requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
          executionLease: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(expectedLease),
          },
          executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });
      const { claimExecutionLease } = await loadSvc();
      const result = await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'fresh-key', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600,
      });
      expect(result.replayed).toBe(false);
      expect(result.lease.id).toBe('new-lease');
    });

    it('handles expiry equality boundary (expiresAt <= now)', async () => {
      const expectedLease = mkLease({ claimKey: 'fresh-key', id: 'new-lease' });
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      let expiredFound = false;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
          executionLease: {
            findMany: vi.fn().mockImplementation(({ where }: any) => {
              if (where.expiresAt?.lte) {
                expiredFound = true;
                return [{ id: 'expired-lease', claimKey: 'old-key' }];
              }
              return [];
            }),
            findFirst: vi.fn().mockImplementation(({ where }: any) => {
              if (where.expiresAt?.gt) return null;
              return null;
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue(expectedLease),
          },
          executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });
      const { claimExecutionLease } = await loadSvc();
      const result = await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'fresh-key', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600,
      });
      expect(result.replayed).toBe(false);
      expect(expiredFound).toBe(true);
    });

    it('rejects idempotencyKey starting with system:', async () => {
      const { claimExecutionLease } = await loadSvc();
      try {
        await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'system:lease-expired:x', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(400);
      }
    });
  });

  describe('renewExecutionLease', () => {
    it('renews with atomic conditional update', async () => {
      const activeLease = mkLease({ expiresAt: new Date(Date.now() + 60_000) });
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      let updateManyCalled = false;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            updateMany: vi.fn().mockImplementation(({ where }: any) => {
              updateManyCalled = true;
              expect(where.id).toBe('lease-uuid-1');
              expect(where.requirementId).toBe('req-uuid-1');
              expect(where.ownerUserId).toBe('user-uuid-1');
              expect(where.sessionId).toBe('session-1');
              expect(where.status).toBe('ACTIVE');
              expect(where.expiresAt?.gt).toBeDefined();
              return { count: 1 };
            }),
            findUnique: vi.fn().mockResolvedValue(activeLease),
          },
          executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        };
        const result = await cb(tx);
        expect(updateManyCalled).toBe(true);
        return result;
      });
      const { renewExecutionLease } = await loadSvc();
      const result = await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'renew-1', sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect(result.replayed).toBe(false);
    });

    it('losing race returns 404 for missing lease', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            findUnique: vi.fn().mockResolvedValue(null),
          },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      const { renewExecutionLease } = await loadSvc();
      try {
        await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'r1', sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(404);
      }
    });

    it('losing race returns 403 for wrong owner', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            findUnique: vi.fn().mockResolvedValue(mkLease({ ownerUserId: 'other-user' })),
          },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      const { renewExecutionLease } = await loadSvc();
      try {
        await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'r1', sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(403);
      }
    });

    it('losing race returns 403 for session mismatch', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            findUnique: vi.fn().mockResolvedValue(mkLease({ sessionId: 'other-session' })),
          },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      const { renewExecutionLease } = await loadSvc();
      try {
        await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'r1', sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(403);
      }
    });

    it('losing race returns 409 for non-active status', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            findUnique: vi.fn().mockResolvedValue(mkLease({ status: 'RELEASED', sessionId: 's1' })),
          },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      const { renewExecutionLease } = await loadSvc();
      try {
        await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'r1', sessionId: 's1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('not active');
      }
    });

    it('losing race with expired lease does conditional expiry and throws 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      let eventCreated = false;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
              if (where.expiresAt?.lte) {
                return { count: 1 };
              }
              return { count: 0 };
            }),
            findUnique: vi.fn().mockResolvedValue(mkLease({ expiresAt: new Date(Date.now() - 1000) })),
          },
          executionLeaseEvent: { create: vi.fn().mockImplementation(() => { eventCreated = true; return {}; }) },
        };
        return cb(tx);
      });
      const { renewExecutionLease } = await loadSvc();
      try {
        await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'r1', sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect(eventCreated).toBe(true);
      }
    });

    it('replays with ttl mismatch -> 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'RENEWED', lease: mkLease(), metadata: { ttl: 7200 } });
      const { renewExecutionLease } = await loadSvc();
      try {
        await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, { idempotencyKey: 'k1', sessionId: 'session-1', ttlSeconds: 3600 });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('ttl');
      }
    });

    it('replays successfully on exact match', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'RENEWED', lease: mkLease(), metadata: { ttl: 3600 } });
      const { renewExecutionLease } = await loadSvc();
      const result = await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'k1', sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect(result.replayed).toBe(true);
    });

    it('renew expiry sentinel: callback returns normally and event is persisted before 409 thrown outside tx', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const eventCreate = vi.fn().mockResolvedValue({});
        const tx = {
          executionLease: {
            updateMany: vi.fn().mockImplementation(({ where }: any) => {
              if (where.expiresAt?.lte) return { count: 1 };
              return { count: 0 };
            }),
            findUnique: vi.fn().mockResolvedValue(mkLease({ expiresAt: new Date(Date.now() - 1000) })),
          },
          executionLeaseEvent: { create: eventCreate },
        };
        const result = await cb(tx);
        expect(result).toHaveProperty('__expired');
        expect(result.__expired).toBe(true);
        expect(eventCreate).toHaveBeenCalledTimes(1);
        return result;
      });
      const { renewExecutionLease } = await loadSvc();
      try {
        await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'r1', sessionId: 'session-1', ttlSeconds: 3600,
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('expired');
      }
    });
  });

  describe('updateLeaseWorktree', () => {
    it('updates with conditional update and validates repoPath', async () => {
      const activeLease = mkLease({ gitBranch: null, worktreePath: null });
      const updatedLease = { ...activeLease, worktreePath: '/worktree/path', gitBranch: 'feat/req-uuid-1-my-feature' };
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            findUnique: vi.fn()
              .mockResolvedValueOnce(activeLease)
              .mockResolvedValueOnce(updatedLease),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });
      const { updateLeaseWorktree } = await loadSvc();
      const lease = await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'wt-1', sessionId: 'session-1',
        worktreePath: '/worktree/path', gitBranch: 'feat/req-uuid-1-my-feature',
      });
      expect(lease.worktreePath).toBe('/worktree/path');
    });

    it('rejects invalid gitBranch with HttpError 400', async () => {
      const { updateLeaseWorktree } = await loadSvc();
      try {
        await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'wt-1', sessionId: 'session-1',
          worktreePath: '/worktree/path', gitBranch: 'invalid',
        });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).statusCode).toBe(400);
      }
    });

    it('replays with worktreePath mismatch -> 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'WORKTREE_BOUND', lease: mkLease(), metadata: { worktreePath: '/other/path', gitBranch: 'feat/req-uuid-1-my-feature' } });
      const { updateLeaseWorktree } = await loadSvc();
      try {
        await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'k1', sessionId: 'session-1',
          worktreePath: '/worktree/path', gitBranch: 'feat/req-uuid-1-my-feature',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('worktreePath');
      }
    });

    it('replays with gitBranch mismatch -> 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({ id: 'e1', eventType: 'WORKTREE_BOUND', lease: mkLease(), metadata: { worktreePath: '/worktree/path', gitBranch: 'feat/req-uuid-1-other-branch' } });
      const { updateLeaseWorktree } = await loadSvc();
      try {
        await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'k1', sessionId: 'session-1',
          worktreePath: '/worktree/path', gitBranch: 'feat/req-uuid-1-my-feature',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('gitBranch');
      }
    });

    it('validates gitBranch starts with feat/<requirementId>-', async () => {
      const activeLease = mkLease();
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: { findUnique: vi.fn().mockResolvedValue(activeLease) },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      const { updateLeaseWorktree } = await loadSvc();
      try {
        await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'wt-1', sessionId: 'session-1',
          worktreePath: '/worktree/path', gitBranch: 'feat/wrong-id-slug',
        });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).statusCode).toBe(400);
        expect((e as HttpError).message).toContain('must start with');
      }
    });

    it('two-bind losing-race: second actor cannot overwrite already-bound metadata, returns 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            findUnique: vi.fn()
              .mockResolvedValueOnce(mkLease({ worktreePath: null, gitBranch: null }))
              .mockResolvedValueOnce(mkLease({ worktreePath: '/already/bound', gitBranch: 'feat/req-uuid-1-existing' })),
            updateMany: vi.fn().mockReturnValue({ count: 0 }),
          },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      const { updateLeaseWorktree } = await loadSvc();
      try {
        await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'wt-loser', sessionId: 'session-1',
          worktreePath: '/different/path', gitBranch: 'feat/req-uuid-1-loser-branch',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('already has a bound worktree');
      }
    });

    it('worktree expiry sentinel: callback returns normally and event is persisted before 409 thrown outside tx', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const eventCreate = vi.fn().mockResolvedValue({});
        const tx = {
          executionLease: {
            findUnique: vi.fn().mockResolvedValue(mkLease({ expiresAt: new Date(Date.now() - 1000), gitBranch: null, worktreePath: null })),
            updateMany: vi.fn().mockImplementation(({ where }: any) => {
              if (where.expiresAt?.lte) return { count: 1 };
              return { count: 0 };
            }),
          },
          executionLeaseEvent: { create: eventCreate },
        };
        const result = await cb(tx);
        expect(result).toHaveProperty('__expired');
        expect(result.__expired).toBe(true);
        expect(eventCreate).toHaveBeenCalledTimes(1);
        return result;
      });
      const { updateLeaseWorktree } = await loadSvc();
      try {
        await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'wt-expired', sessionId: 'session-1',
          worktreePath: '/new/path', gitBranch: 'feat/req-uuid-1-my-feature',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('expired');
      }
    });
  });

  describe('releaseExecutionLease', () => {
    it('releases SUCCEEDED with conditional update', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            findUnique: vi.fn().mockResolvedValue(mkLease()),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          executionLeaseEvent: { create: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });
      const { releaseExecutionLease } = await loadSvc();
      const lease = await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'rel-1', sessionId: 'session-1', outcome: 'SUCCEEDED', reason: 'task completed',
      });
      expect(lease.status).toBe('ACTIVE');
    });

    it('rejects FAILED replay for ABANDONED outcome', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
        id: 'e1', eventType: 'FAILED', lease: mkLease({ status: 'FAILED' }), metadata: { outcome: 'FAILED', reason: null },
      });
      const { releaseExecutionLease } = await loadSvc();
      try {
        await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'k1', sessionId: 'session-1', outcome: 'ABANDONED',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('outcome');
      }
    });

    it('rejects ABANDONED replay for FAILED outcome', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
        id: 'e1', eventType: 'ABANDONED', lease: mkLease({ status: 'ABANDONED' }), metadata: { outcome: 'ABANDONED', reason: null },
      });
      const { releaseExecutionLease } = await loadSvc();
      try {
        await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'k1', sessionId: 'session-1', outcome: 'FAILED',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('outcome');
      }
    });

    it('allows exact-match replay for SUCCEEDED', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
        id: 'e1', eventType: 'RELEASED', lease: mkLease({ status: 'RELEASED' }), metadata: { outcome: 'SUCCEEDED', reason: 'task completed' },
      });
      const { releaseExecutionLease } = await loadSvc();
      const lease = await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'k1', sessionId: 'session-1', outcome: 'SUCCEEDED', reason: 'task completed',
      });
      expect(lease.status).toBe('RELEASED');
    });

    it('rejects release replay with reason mismatch', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
        id: 'e1', eventType: 'RELEASED', lease: mkLease({ status: 'RELEASED' }), metadata: { outcome: 'SUCCEEDED', reason: 'task completed' },
      });
      const { releaseExecutionLease } = await loadSvc();
      try {
        await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'k1', sessionId: 'session-1', outcome: 'SUCCEEDED', reason: 'different reason',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
        expect((e as HttpError).message).toContain('reason');
      }
    });

    it('allows release replay with null/undefined reason normalization match', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
        id: 'e1', eventType: 'FAILED', lease: mkLease({ status: 'FAILED' }), metadata: { outcome: 'FAILED', reason: null },
      });
      const { releaseExecutionLease } = await loadSvc();
      const lease = await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
        idempotencyKey: 'k1', sessionId: 'session-1', outcome: 'FAILED',
      });
      expect(lease.status).toBe('FAILED');
    });

    it('losing race with expired lease does conditional expiry and throws 409', async () => {
      mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const eventCreate = vi.fn().mockResolvedValue({});
        const tx = {
          executionLease: {
            findUnique: vi.fn().mockResolvedValue(mkLease({ expiresAt: new Date(Date.now() - 1000) })),
            updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
              if (where.expiresAt?.lte) return { count: 1 };
              return { count: 0 };
            }),
          },
          executionLeaseEvent: { create: eventCreate },
        };
        const result = await cb(tx);
        expect(result).toHaveProperty('__expired');
        expect(result.__expired).toBe(true);
        expect(eventCreate).toHaveBeenCalledTimes(1);
        return result;
      });
      const { releaseExecutionLease } = await loadSvc();
      try {
        await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', null, {
          idempotencyKey: 'rel-1', sessionId: 'session-1', outcome: 'SUCCEEDED',
        });
        expect.unreachable();
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(409);
      }
    });
  });

  describe('getExecutionLease', () => {
    it('returns active lease without sessionId and history', async () => {
      const activeLease = mkLease({ status: 'ACTIVE' });
      const historyItems = [
        { id: 'old-lease', status: 'RELEASED', acquiredAt: new Date(), releasedAt: new Date(), releaseReason: 'completed', ownerUserId: 'u1' },
      ];
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            findMany: vi.fn().mockResolvedValue([]),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      mockPrisma.executionLease.findFirst.mockResolvedValue(activeLease);
      mockPrisma.executionLease.findMany.mockResolvedValue(historyItems);
      const { getExecutionLease } = await loadSvc();
      const result = await getExecutionLease('req-uuid-1');
      expect(result.active).not.toBeNull();
      expect(result.active!.leaseId).toBe('lease-uuid-1');
      expect(result.active).not.toHaveProperty('sessionId');
      expect(result.history).toHaveLength(1);
    });

    it('cannot expire a concurrently renewed lease', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            findMany: vi.fn().mockResolvedValue([{ id: 'old-lease', claimKey: 'old-key' }]),
            updateMany: vi.fn().mockReturnValue({ count: 0 }),
          },
          executionLeaseEvent: { create: vi.fn() },
        };
        return cb(tx);
      });
      mockPrisma.executionLease.findFirst.mockResolvedValue(mkLease({ status: 'ACTIVE' }));
      mockPrisma.executionLease.findMany.mockResolvedValue([]);
      const { getExecutionLease } = await loadSvc();
      const result = await getExecutionLease('req-uuid-1');
      expect(result.active).not.toBeNull();
    });

    it('emits EXPIRED event only for update count=1 with actorId null', async () => {
      let expiredEventData: any = null;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          executionLease: {
            findMany: vi.fn().mockResolvedValue([{ id: 'old-lease', claimKey: 'old-key' }]),
            updateMany: vi.fn().mockReturnValue({ count: 1 }),
          },
          executionLeaseEvent: {
            create: vi.fn().mockImplementation(({ data }: any) => {
              expiredEventData = data;
              return {};
            }),
          },
        };
        return cb(tx);
      });
      mockPrisma.executionLease.findFirst.mockResolvedValue(null);
      mockPrisma.executionLease.findMany.mockResolvedValue([]);
      const { getExecutionLease } = await loadSvc();
      await getExecutionLease('req-uuid-1');
      expect(expiredEventData).not.toBeNull();
      expect(expiredEventData.actorId).toBeNull();
      expect(expiredEventData.idempotencyKey).toBe('system:lease-expired:old-lease');
      expect(expiredEventData.eventType).toBe('EXPIRED');
    });
  });
});

describe('execution-lease zod schemas', () => {
  it('claimLeaseSchema accepts valid input', async () => {
    const { claimLeaseSchema } = await import('../schemas/execution-lease.js');
    const result = claimLeaseSchema.parse({
      body: { idempotencyKey: 'key-1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-abc', ttlSeconds: 3600 },
    });
    expect(result.body.ttlSeconds).toBe(3600);
  });

  it('claimLeaseSchema defaults ttlSeconds to 3600', async () => {
    const { claimLeaseSchema } = await import('../schemas/execution-lease.js');
    const result = claimLeaseSchema.parse({
      body: { idempotencyKey: 'key-1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-abc' },
    });
    expect(result.body.ttlSeconds).toBe(3600);
  });

  it('claimLeaseSchema rejects ttlSeconds out of range', async () => {
    const { claimLeaseSchema } = await import('../schemas/execution-lease.js');
    expect(() => claimLeaseSchema.parse({
      body: { idempotencyKey: 'key-1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-abc', ttlSeconds: 299 },
    })).toThrow();
    expect(() => claimLeaseSchema.parse({
      body: { idempotencyKey: 'key-1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-abc', ttlSeconds: 14401 },
    })).toThrow();
  });

  it('claimLeaseSchema rejects system: idempotencyKey', async () => {
    const { claimLeaseSchema } = await import('../schemas/execution-lease.js');
    expect(() => claimLeaseSchema.parse({
      body: { idempotencyKey: 'system:lease-expired:x', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1' },
    })).toThrow();
  });

  it('updateWorktreeSchema rejects feat/x- as invalid branch', async () => {
    const { updateWorktreeSchema } = await import('../schemas/execution-lease.js');
    expect(() => updateWorktreeSchema.parse({
      body: { idempotencyKey: 'key-1', sessionId: 's1', worktreePath: '/path', gitBranch: 'feat/req-uuid-1-' },
    })).toThrow();
  });

  it('updateWorktreeSchema rejects feat/x with no slug after dash', async () => {
    const { updateWorktreeSchema } = await import('../schemas/execution-lease.js');
    expect(() => updateWorktreeSchema.parse({
      body: { idempotencyKey: 'key-1', sessionId: 's1', worktreePath: '/path', gitBranch: 'feat/uuid-' },
    })).toThrow();
  });

  it('updateWorktreeSchema accepts valid gitBranch with slug', async () => {
    const { updateWorktreeSchema } = await import('../schemas/execution-lease.js');
    const result = updateWorktreeSchema.parse({
      body: { idempotencyKey: 'key-1', sessionId: 's1', worktreePath: '/absolute/path', gitBranch: 'feat/req-uuid-1-my-feature' },
    });
    expect(result.body.gitBranch).toBe('feat/req-uuid-1-my-feature');
  });

  it('updateWorktreeSchema rejects uppercase in slug', async () => {
    const { updateWorktreeSchema } = await import('../schemas/execution-lease.js');
    expect(() => updateWorktreeSchema.parse({
      body: { idempotencyKey: 'key-1', sessionId: 's1', worktreePath: '/path', gitBranch: 'feat/req-uuid-1-MY-FEATURE' },
    })).toThrow();
  });

  it('updateWorktreeSchema rejects empty trailing separator', async () => {
    const { updateWorktreeSchema } = await import('../schemas/execution-lease.js');
    expect(() => updateWorktreeSchema.parse({
      body: { idempotencyKey: 'key-1', sessionId: 's1', worktreePath: '/path', gitBranch: 'feat/req-uuid-1-my-' },
    })).toThrow();
  });

  it('rejects system: prefix in all schemas', async () => {
    const { renewLeaseSchema, releaseLeaseSchema, updateWorktreeSchema } = await import('../schemas/execution-lease.js');
    expect(() => renewLeaseSchema.parse({ body: { idempotencyKey: 'system:x', sessionId: 's1' } })).toThrow();
    expect(() => releaseLeaseSchema.parse({ body: { idempotencyKey: 'system:x', sessionId: 's1', outcome: 'SUCCEEDED' } })).toThrow();
    expect(() => updateWorktreeSchema.parse({ body: { idempotencyKey: 'system:x', sessionId: 's1', worktreePath: '/p', gitBranch: 'feat/req-uuid-1-a' } })).toThrow();
  });
});

describe('migration static assertions', () => {
  it('ownerAgentId is TEXT (not UUID) in migration', async () => {
    const fs = await import('fs');
    const sql = fs.readFileSync(
      new URL('../../prisma/migrations/20260619000001_add_execution_lease/migration.sql', import.meta.url),
      'utf-8',
    );
    const ownerAgentLine = sql.split('\n').find((l: string) => l.includes('ownerAgentId'));
    expect(ownerAgentLine).toBeDefined();
    expect(ownerAgentLine).not.toContain('UUID');
    expect(ownerAgentLine).toContain('TEXT');
  });

  it('execution_leases_claimKey_idx is removed', async () => {
    const fs = await import('fs');
    const sql = fs.readFileSync(
      new URL('../../prisma/migrations/20260619000001_add_execution_lease/migration.sql', import.meta.url),
      'utf-8',
    );
    expect(sql).not.toContain('execution_leases_claimKey_idx');
  });

  it('partial unique ACTIVE index exists', async () => {
    const fs = await import('fs');
    const sql = fs.readFileSync(
      new URL('../../prisma/migrations/20260619000001_add_execution_lease/migration.sql', import.meta.url),
      'utf-8',
    );
    expect(sql).toContain('execution_leases_requirementId_active_key');
    expect(sql).toContain('WHERE "status" = \'ACTIVE\'');
  });

  it('execution_lease_events FK has ON DELETE CASCADE on the leaseId FK block', async () => {
    const fs = await import('fs');
    const sql = fs.readFileSync(
      new URL('../../prisma/migrations/20260619000001_add_execution_lease/migration.sql', import.meta.url),
      'utf-8',
    );
    const lines = sql.split('\n');
    const fkIdx = lines.findIndex((l: string) => l.includes('execution_lease_events_leaseId_fkey'));
    expect(fkIdx).toBeGreaterThanOrEqual(0);
    const fkBlock = lines.slice(fkIdx, fkIdx + 5).join('\n');
    expect(fkBlock).toContain('ON DELETE CASCADE');
    expect(fkBlock).toContain('execution_lease_events_leaseId_fkey');
  });

  it('Prisma schema ExecutionLeaseEvent.lease has onDelete Cascade', async () => {
    const fs = await import('fs');
    const schema = fs.readFileSync(
      new URL('../../prisma/schema.prisma', import.meta.url),
      'utf-8',
    );
    const eventModel = schema.split('model ExecutionLeaseEvent {')[1]?.split('model ')[0] ?? '';
    expect(eventModel).toContain('onDelete: Cascade');
  });
});

describe('no forbidden APIs', () => {
  it('does not import child_process in lease modules', async () => {
    const fs = await import('fs');
    const files = [
      'lease-claim.ts', 'lease-renew.ts', 'lease-release.ts',
      'lease-worktree.ts', 'lease-get.ts', 'lease-lazy-expire.ts',
      'lease-constants.ts', 'index.ts',
    ];
    for (const file of files) {
      const content = fs.readFileSync(
        new URL(`../lib/execution-lease/${file}`, import.meta.url),
        'utf-8',
      );
      expect(content).not.toContain('child_process');
      expect(content).not.toContain('execSync');
      expect(content).not.toContain("exec('");
      expect(content).not.toContain('execSync(');
      expect(content).not.toContain('node:fs');
      expect(content).not.toContain("require('child_process')");
    }
  });
});

describe('validateGitBranch', () => {
  it('throws HttpError 400 for wrong prefix', async () => {
    const { validateGitBranch } = await import('../lib/execution-lease/lease-constants.js');
    try {
      validateGitBranch('feat/wrong-id-slug', 'req-uuid-1');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(400);
    }
  });

  it('throws HttpError 400 for empty slug', async () => {
    const { validateGitBranch } = await import('../lib/execution-lease/lease-constants.js');
    try {
      validateGitBranch('feat/req-uuid-1-', 'req-uuid-1');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(400);
    }
  });
});

describe('ownerAgent enforcement', () => {
  it('claim persists ownerAgentId in lease and event metadata', async () => {
    const { claimExecutionLease } = await loadSvc();
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let leaseData: any = null;
    let eventData: any = null;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        requirement: { findUnique: vi.fn().mockResolvedValue({ id: 'req-uuid-1', currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1' }) },
        executionLease: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => { leaseData = data; return mkLease({ ownerAgentId: 'agent-1', claimKey: 'fresh-key', id: 'new-lease' }); }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(({ data }: any) => { eventData = data; return {}; }) },
      };
      return cb(tx);
    });
    await claimExecutionLease('req-uuid-1', 'user-uuid-1', 'agent-1', {
      idempotencyKey: 'fresh-key', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 's1', ttlSeconds: 3600,
    });
    expect(leaseData.ownerAgentId).toBe('agent-1');
    expect(eventData.metadata.ownerAgentId).toBe('agent-1');
  });

  it('claim replay with null-safe ownerAgentId mismatch returns 409 (agent vs null)', async () => {
    const { claimExecutionLease } = await loadSvc();
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'CLAIMED', lease: mkLease({ ownerAgentId: 'agent-1' }),
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

  it('claim replay with null-safe ownerAgentId mismatch returns 409 (null vs agent)', async () => {
    const { claimExecutionLease } = await loadSvc();
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'CLAIMED', lease: mkLease({ ownerAgentId: null }),
      metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 0, ttl: 3600 },
    });
    try {
      await claimExecutionLease('req-uuid-1', 'user-uuid-1', 'agent-2', {
        idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('ownerAgentId');
    }
  });

  it('claim replay with exact ownerAgentId match passes', async () => {
    const { claimExecutionLease } = await loadSvc();
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'CLAIMED', lease: mkLease({ ownerAgentId: 'agent-1' }),
      metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 0, ttl: 3600 },
    });
    const result = await claimExecutionLease('req-uuid-1', 'user-uuid-1', 'agent-1', {
      idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600,
    });
    expect(result.replayed).toBe(true);
  });

  it('claim replay with both ownerAgentId null passes', async () => {
    const { claimExecutionLease } = await loadSvc();
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'CLAIMED', lease: mkLease({ ownerAgentId: null }),
      metadata: { expectedStep: 'dev_self_check', expectedStateVersion: 0, ttl: 3600 },
    });
    const result = await claimExecutionLease('req-uuid-1', 'user-uuid-1', null, {
      idempotencyKey: 'k1', expectedStep: 'dev_self_check', expectedStateVersion: 0, sessionId: 'session-1', ttlSeconds: 3600,
    });
    expect(result.replayed).toBe(true);
  });

  it('renew normal mismatch ownerAgentId returns 403 and no event.create', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let eventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        executionLease: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn().mockResolvedValue(mkLease({ ownerAgentId: null })),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { eventCreated = true; return {}; }) },
      };
      return cb(tx);
    });
    const { renewExecutionLease } = await loadSvc();
    try {
      await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', 'agent-2', {
        idempotencyKey: 'r1', sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(403);
      expect((e as HttpError).message).toContain('different agent');
      expect(eventCreated).toBe(false);
    }
  });

  it('renew idempotent replay different ownerAgentId returns 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'RENEWED', lease: mkLease({ ownerAgentId: 'agent-1' }),
      metadata: { ttl: 3600 },
    });
    const { renewExecutionLease } = await loadSvc();
    try {
      await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', 'agent-2', {
        idempotencyKey: 'r1', sessionId: 'session-1', ttlSeconds: 3600,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('ownerAgentId');
    }
  });

  it('renew idempotent replay exact same agentId succeeds', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'RENEWED', lease: mkLease({ ownerAgentId: 'agent-1' }),
      metadata: { ttl: 3600 },
    });
    const { renewExecutionLease } = await loadSvc();
    const result = await renewExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', 'agent-1', {
      idempotencyKey: 'r1', sessionId: 'session-1', ttlSeconds: 3600,
    });
    expect(result.replayed).toBe(true);
  });

  it('worktree normal mismatch ownerAgentId returns 403 before mutation/event', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let leaseUpdateManyCalled = false;
    let eventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        executionLease: {
          findUnique: vi.fn().mockResolvedValue(mkLease({ ownerAgentId: null, requirement: { currentStep: 'dev_self_check', stateVersion: 0, assigneeId: 'user-uuid-1', repoPath: '/repo' } })),
          updateMany: vi.fn().mockImplementation(() => { leaseUpdateManyCalled = true; return { count: 1 }; }),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { eventCreated = true; return {}; }) },
      };
      return cb(tx);
    });
    const { updateLeaseWorktree } = await loadSvc();
    try {
      await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', 'agent-2', {
        idempotencyKey: 'w1', sessionId: 'session-1', worktreePath: '/worktree/test', gitBranch: 'feat/req-uuid-1-feature',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(403);
      expect((e as HttpError).message).toContain('different agent');
      expect(leaseUpdateManyCalled).toBe(false);
      expect(eventCreated).toBe(false);
    }
  });

  it('worktree idempotent replay different ownerAgentId returns 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'WORKTREE_BOUND', lease: mkLease({ ownerAgentId: 'agent-1' }),
      metadata: { worktreePath: '/wt', gitBranch: 'feat/req-uuid-1-feature' },
    });
    const { updateLeaseWorktree } = await loadSvc();
    try {
      await updateLeaseWorktree('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', 'agent-2', {
        idempotencyKey: 'w1', sessionId: 'session-1', worktreePath: '/wt', gitBranch: 'feat/req-uuid-1-feature',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('ownerAgentId');
    }
  });

  it('release normal mismatch ownerAgentId returns 403 and no event.create', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue(null);
    let eventCreated = false;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        executionLease: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn().mockResolvedValue(mkLease({ ownerAgentId: null })),
        },
        executionLeaseEvent: { create: vi.fn().mockImplementation(() => { eventCreated = true; return {}; }) },
      };
      return cb(tx);
    });
    const { releaseExecutionLease } = await loadSvc();
    try {
      await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', 'agent-2', {
        idempotencyKey: 'rel-1', sessionId: 'session-1', outcome: 'SUCCEEDED',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(403);
      expect((e as HttpError).message).toContain('different agent');
      expect(eventCreated).toBe(false);
    }
  });

  it('release idempotent replay different ownerAgentId returns 409', async () => {
    mockPrisma.executionLeaseEvent.findUnique.mockResolvedValue({
      id: 'e1', eventType: 'RELEASED', lease: mkLease({ ownerAgentId: 'agent-1' }),
      metadata: { outcome: 'SUCCEEDED' },
    });
    const { releaseExecutionLease } = await loadSvc();
    try {
      await releaseExecutionLease('req-uuid-1', 'lease-uuid-1', 'user-uuid-1', 'agent-2', {
        idempotencyKey: 'rel-1', sessionId: 'session-1', outcome: 'SUCCEEDED',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(409);
      expect((e as HttpError).message).toContain('ownerAgentId');
    }
  });
});

describe('module line limits', () => {
  it('all production modules are <= 220 lines', async () => {
    const fs = await import('fs');
    const files = [
      'lease-claim.ts', 'lease-renew.ts', 'lease-release.ts',
      'lease-worktree.ts', 'lease-get.ts', 'lease-lazy-expire.ts',
      'lease-constants.ts', 'index.ts',
    ];
    for (const file of files) {
      const content = fs.readFileSync(
        new URL(`../lib/execution-lease/${file}`, import.meta.url),
        'utf-8',
      );
      const lines = content.split('\n').length;
      expect(lines).toBeLessThanOrEqual(220);
    }
  });
});
