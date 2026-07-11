/**
 * workflow-snapshot-advance.test.ts
 *
 * workflowSnapshot fallback — ADVANCE scenarios (1-7).
 *
 * Coverage:
 *   1. relation exists → normal advance
 *   2. relation null, snapshot exists → advance via snapshot
 *   3. both null → 400 "该需求未分配工作流"
 *   4. invalid snapshot → safe 400
 *   5. unauthorized role → 403
 *   6. advance → WorkflowTransition created
 *   7. advance → WORKFLOW_ADVANCED ledger event
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

// ── Hoisted mocks (must be before all imports) ──────────────

const { mockFindUnique, mockUpdate, mockUpdateMany, mockTxUpdateManyReturn,
        mockTransitionCreate, mockLedgerCreate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(), mockUpdate: vi.fn(), mockUpdateMany: vi.fn(),
  mockTxUpdateManyReturn: vi.fn().mockReturnValue(undefined),
  mockTransitionCreate: vi.fn(), mockLedgerCreate: vi.fn(),
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
    testEnvLock: { findUnique: vi.fn(), deleteMany: vi.fn() },
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
      testEnvLock: { findUnique: vi.fn(), deleteMany: vi.fn() },
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
import { errorHandler } from '../middleware/error-handler.js';

import {
  REQ_ID, QA_USER_ID, DEV_USER, QA_USER,
  SNAPSHOT_VALID, SNAPSHOT_INVALID,
  makeReq, httpPost,
} from './workflow-snapshot-helpers.js';

function createApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.user = user ?? QA_USER; next(); });
  const router = express.Router();
  registerWorkflowAdvanceRoutes(router);
  app.use('/api/requirements', router);
  app.use(errorHandler);
  return app;
}

describe('POST /:id/workflow/advance — workflowSnapshot fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolverMocks.getAssigneeName.mockImplementation(async (id: string | null) => {
      if (id === QA_USER_ID) return 'QA User';
      return null;
    });
  });

  it('1. relation exists: advance succeeds', async () => {
    const req = makeReq({ workflow: { id: 'wf-1', steps: SNAPSHOT_VALID }, workflowSnapshot: undefined });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'done' });
    mockTransitionCreate.mockResolvedValue({});
    mockLedgerCreate.mockResolvedValue({});
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'adv' });
    expect(res.status).toBe(200);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  it('2. relation null + snapshot exists: advance succeeds', async () => {
    const req = makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'done' });
    mockTransitionCreate.mockResolvedValue({});
    mockLedgerCreate.mockResolvedValue({});
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'adv' });
    expect(res.status).toBe(200);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  it('3. both null: returns 400', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: null }));
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'adv' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('该需求未分配工作流');
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('4. invalid snapshot: returns 400 safely', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_INVALID }));
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'adv' });
    expect(res.status).toBe(400);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('5. unauthorized role gets 403', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }));
    const res = await httpPost(createApp(DEV_USER), `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'adv' });
    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('6. creates WorkflowTransition', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }));
    mockUpdate.mockResolvedValue({ currentStep: 'done' });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({});
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'adv' });
    expect(res.status).toBe(200);
    expect(mockTransitionCreate.mock.calls[0]?.[0]?.data?.action).toBe('advance');
  });

  it('7. creates WORKFLOW_ADVANCED ledger event', async () => {
    mockFindUnique.mockResolvedValue(makeReq({ workflowId: null, workflow: null, workflowSnapshot: SNAPSHOT_VALID }));
    mockUpdate.mockResolvedValue({ currentStep: 'done' });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({});
    const res = await httpPost(createApp(QA_USER), `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'adv' });
    expect(res.status).toBe(200);
    const arg = mockLedgerCreate.mock.calls[0]?.[0];
    expect(arg?.data?.eventType).toBe('WORKFLOW_ADVANCED');
    expect(arg?.data?.requirementId).toBe(REQ_ID);
  });
});
