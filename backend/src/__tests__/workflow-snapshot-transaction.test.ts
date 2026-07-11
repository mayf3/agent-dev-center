/**
 * workflow-snapshot-transaction.test.ts
 *
 * Transaction rollback and domain access scenarios.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const { mockFindUnique, mockUpdateMany, mockTxUpdateManyReturn,
        mockTransitionCreate, mockLedgerCreate, mockLockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(), mockUpdateMany: vi.fn(),
  mockTxUpdateManyReturn: vi.fn().mockReturnValue(undefined),
  mockTransitionCreate: vi.fn(), mockLedgerCreate: vi.fn(), mockLockFindUnique: vi.fn(),
}));

const resolverMocks = vi.hoisted(() => ({ getAssigneeName: vi.fn() }));

vi.mock('../lib/prisma.js', () => {
  const makeTx = () => ({
    requirement: {
      findUnique: mockFindUnique,
      updateMany: vi.fn((args: any) => {
        mockUpdateMany(args);
        const o = mockTxUpdateManyReturn();
        return o !== undefined ? o : { count: 1 };
      }),
    },
    workflowTransition: { create: mockTransitionCreate },
    requirementEventLedger: { create: mockLedgerCreate },
    testEnvLock: { findUnique: mockLockFindUnique, deleteMany: vi.fn() },
    notification: { create: vi.fn().mockResolvedValue({}) },
    requirementRevision: { create: vi.fn().mockResolvedValue({}) },
    requirementReport: { findMany: vi.fn().mockResolvedValue([]) },
    testEnvQueue: { findFirst: vi.fn() },
  });
  return {
    prisma: {
      $transaction: vi.fn((cb: any) => cb(makeTx())),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      requirement: { findUnique: mockFindUnique, update: vi.fn(), updateMany: mockUpdateMany },
      workflowTransition: { create: mockTransitionCreate },
      requirementEventLedger: { create: mockLedgerCreate },
      requirementReport: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      testEnvLock: { findUnique: mockLockFindUnique, deleteMany: vi.fn() },
      notification: { create: vi.fn().mockResolvedValue({}) },
      workflowTemplate: { findFirst: vi.fn() },
      requirementRevision: { create: vi.fn().mockResolvedValue({}) },
    },
  };
});

vi.mock('../lib/assignee-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/assignee-resolver.js')>();
  return {
    ...actual,
    resolveAssigneeForStep: vi.fn((...args: any[]) => actual.resolveAssigneeForStep(...args)),
    getAssigneeName: resolverMocks.getAssigneeName,
  };
});

import { registerWorkflowAdvanceRoutes } from '../routes/requirements/workflow-advance.js';
import { registerWorkflowRejectRoutes } from '../routes/requirements/workflow-reject.js';
import { errorHandler } from '../middleware/error-handler.js';

import {
  REQ_ID, DEV_USER_ID, QA_USER_ID, QA_USER,
  SNAPSHOT_VALID,
  makeReq, httpPost,
} from './workflow-snapshot-helpers.js';

function createAdvanceApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.user = user ?? QA_USER; next(); });
  const router = express.Router();
  registerWorkflowAdvanceRoutes(router);
  app.use('/api/requirements', router);
  app.use(errorHandler);
  return app;
}

function createRejectApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.user = user ?? QA_USER; next(); });
  const router = express.Router();
  registerWorkflowRejectRoutes(router);
  app.use('/api/requirements', router);
  app.use(errorHandler);
  return app;
}

/** Shared mock setup: getAssigneeName handles all common user IDs */
function setupMocks() {
  resolverMocks.getAssigneeName.mockImplementation(async (id: string | null) => {
    if (id === DEV_USER_ID) return 'Developer';
    if (id === QA_USER_ID) return 'QA User';
    if (id === REQ_ID) return '需求提出者';
    return null;
  });
}

describe('CAS failure — transaction rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('10. advance CAS failure: 409', async () => {
    mockFindUnique.mockResolvedValue(
      makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }),
    );
    mockTxUpdateManyReturn.mockReturnValue({ count: 0 });
    const res = await httpPost(
      createAdvanceApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/advance`,
      { comment: 'adv' },
    );
    expect(res.status).toBe(409);
  });

  it('10. reject CAS failure: 409', async () => {
    mockFindUnique.mockResolvedValue(
      makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }),
    );
    mockLockFindUnique.mockResolvedValue(null);
    mockTxUpdateManyReturn.mockReturnValue({ count: 0 });
    const res = await httpPost(
      createRejectApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' },
    );
    expect(res.status).toBe(409);
  });
});

describe('Domain/Auth protection with workflowSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('advance: outside domain gets 403', async () => {
    mockFindUnique.mockResolvedValue(makeReq({
      workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID,
      domainKey: 'restricted-domain',
    }));
    const outsideUser = { ...QA_USER, allowedDomainKeys: ['other-domain'] };
    const res = await httpPost(
      createAdvanceApp(outsideUser), `/api/requirements/${REQ_ID}/workflow/advance`,
      { comment: 'adv' },
    );
    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('reject: outside domain gets 403', async () => {
    mockFindUnique.mockResolvedValue(makeReq({
      workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID,
      domainKey: 'restricted-domain',
    }));
    const outsideUser = { ...QA_USER, allowedDomainKeys: ['other-domain'] };
    const res = await httpPost(
      createRejectApp(outsideUser), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' },
    );
    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });
});
