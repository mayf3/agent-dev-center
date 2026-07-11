/**
 * workflow-snapshot-reject.test.ts
 *
 * workflowSnapshot fallback — REJECT scenarios (1-5, 8-9).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const { mockFindUnique, mockUpdate, mockUpdateMany, mockTxUpdateManyReturn,
        mockTransitionCreate, mockLedgerCreate, mockLockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(), mockUpdate: vi.fn(), mockUpdateMany: vi.fn(),
  mockTxUpdateManyReturn: vi.fn().mockReturnValue(undefined),
  mockTransitionCreate: vi.fn(), mockLedgerCreate: vi.fn(), mockLockFindUnique: vi.fn(),
}));

const resolverMocks = vi.hoisted(() => ({ getAssigneeName: vi.fn() }));

vi.mock('../lib/prisma.js', () => {
  const makeTx = () => ({
    requirement: {
      findUnique: mockFindUnique,
      updateMany: vi.fn((args: any) => { mockUpdateMany(args); mockUpdate(args); const o = mockTxUpdateManyReturn(); return o !== undefined ? o : { count: 1 }; }),
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
      requirement: { findUnique: mockFindUnique, update: mockUpdate, updateMany: mockUpdateMany },
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

import { registerWorkflowRejectRoutes } from '../routes/requirements/workflow-reject.js';
import { errorHandler } from '../middleware/error-handler.js';

import {
  REQ_ID, DEV_USER_ID, QA_USER_ID, DEV_USER, QA_USER,
  SNAPSHOT_VALID, SNAPSHOT_INVALID,
  makeReq, httpPost,
} from './workflow-snapshot-helpers.js';

function createApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.user = user ?? QA_USER; next(); });
  const router = express.Router();
  registerWorkflowRejectRoutes(router);
  app.use('/api/requirements', router);
  app.use(errorHandler);
  return app;
}

describe('POST /:id/workflow/reject — workflowSnapshot fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolverMocks.getAssigneeName.mockImplementation(async (id: string | null) => {
      if (id === DEV_USER_ID) return 'Developer';
      if (id === QA_USER_ID) return 'QA User';
      if (id === REQ_ID) return '需求提出者';
      return null;
    });
  });

  it('1. reject with relation exists: succeeds', async () => {
    const req = makeReq({ workflow: { id: 'wf-1', steps: SNAPSHOT_VALID }, workflowSnapshot: undefined });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check' });
    mockTransitionCreate.mockResolvedValue({});
    mockLedgerCreate.mockResolvedValue({});
    mockLockFindUnique.mockResolvedValue(null);
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  it('2. reject with snapshot only: succeeds', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }));
    mockUpdate.mockResolvedValue({ currentStep: 'dev_self_check' });
    mockTransitionCreate.mockResolvedValue({});
    mockLedgerCreate.mockResolvedValue({});
    mockLockFindUnique.mockResolvedValue(null);
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  it('3. both null: returns 400', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: null }));
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('该需求未分配工作流');
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('4. invalid snapshot: 400 safely', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_INVALID }));
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('5. unauthorized role gets 403', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }));
    const res = await httpPost(createApp(DEV_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' });
    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('8. creates WorkflowTransition', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }));
    mockUpdate.mockResolvedValue({ currentStep: 'dev_self_check' });
    mockTransitionCreate.mockResolvedValue({});
    mockLedgerCreate.mockResolvedValue({});
    mockLockFindUnique.mockResolvedValue(null);
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockTransitionCreate.mock.calls[0]?.[0]?.data?.action).toBe('reject');
  });

  it('9. creates WORKFLOW_REJECTED ledger event', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }));
    mockUpdate.mockResolvedValue({ currentStep: 'dev_self_check' });
    mockTransitionCreate.mockResolvedValue({});
    mockLedgerCreate.mockResolvedValue({});
    mockLockFindUnique.mockResolvedValue(null);
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/reject`,
      { comment: 'rej', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    const arg = mockLedgerCreate.mock.calls[0]?.[0];
    expect(arg?.data?.eventType).toBe('WORKFLOW_REJECTED');
    expect(arg?.data?.requirementId).toBe(REQ_ID);
  });
});
