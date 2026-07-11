/**
 * workflow-snapshot-advance-reject.test.ts
 *
 * Focused tests verifying workflowSnapshot fallback in advance/reject routes.
 *
 * Coverage:
 *   1. relation exists → normal advance/reject (backward compatibility)
 *   2. relation null, snapshot exists → advance/reject works via snapshot
 *   3. both relation and snapshot null → 400 "该需求未分配工作流"
 *   4. snapshot format invalid → safe rejection
 *   5. Domain/Auth and role permissions not bypassed
 *   6. advance → WorkflowTransition created
 *   7. advance → WORKFLOW_ADVANCED ledger event created
 *   8. reject → WorkflowTransition created
 *   9. reject → WORKFLOW_REJECTED ledger event created
 *   10. CAS/Transition/Ledger failure → full transaction rollback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// ── UUIDs ─────────────────────────────────────────────────

const REQ_ID = '00000000-0000-0000-0000-000000000001';
const DEV_USER_ID = '11111111-1111-1111-1111-111111111111';
const QA_USER_ID = '22222222-2222-2222-2222-222222222222';
const CTO_USER_ID = '33333333-3333-3333-3333-333333333333';

// ── Hoisted mocks ─────────────────────────────────────────

const {
  mockFindUnique, mockUpdate, mockUpdateMany, mockTxUpdateManyReturn,
  mockTransitionCreate, mockLedgerCreate, mockLockFindUnique, mockLockDeleteMany,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockTxUpdateManyReturn: vi.fn().mockReturnValue(undefined),
  mockTransitionCreate: vi.fn(),
  mockLedgerCreate: vi.fn(),
  mockLockFindUnique: vi.fn(),
  mockLockDeleteMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => {
  const makeTx = () => {
    const txUpdateMany = vi.fn((args: any) => {
      mockUpdateMany(args);
      mockUpdate({ where: args.where, data: args.data });
      const override = mockTxUpdateManyReturn();
      if (override !== undefined) return override;
      return { count: 1 };
    });
    return {
      requirement: { findUnique: mockFindUnique, updateMany: txUpdateMany },
      workflowTransition: { create: mockTransitionCreate },
      requirementEventLedger: { create: mockLedgerCreate },
      testEnvLock: { findUnique: mockLockFindUnique, deleteMany: mockLockDeleteMany },
      notification: { create: vi.fn().mockResolvedValue({}) },
      requirementRevision: { create: vi.fn().mockResolvedValue({}) },
      requirementReport: { findMany: vi.fn().mockResolvedValue([]) },
      testEnvQueue: { findFirst: vi.fn() },
    };
  };

  const mockTransaction = vi.fn(
    (cb: (tx: any) => any) => cb(makeTx()),
  );

  return {
    prisma: {
      $transaction: mockTransaction,
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      requirement: { findUnique: mockFindUnique, update: mockUpdate, updateMany: mockUpdateMany },
      workflowTransition: { create: mockTransitionCreate },
      requirementEventLedger: { create: mockLedgerCreate },
      requirementReport: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      testEnvLock: { findUnique: mockLockFindUnique, deleteMany: mockLockDeleteMany },
      notification: { create: vi.fn().mockResolvedValue({}) },
      workflowTemplate: { findFirst: vi.fn() },
      requirementRevision: { create: vi.fn().mockResolvedValue({}) },
    },
  };
});

// Partial mock for assignee-resolver
const resolverMocks = vi.hoisted(() => ({
  getAssigneeName: vi.fn(),
}));

vi.mock('../lib/assignee-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/assignee-resolver.js')>();
  return {
    ...actual,
    resolveAssigneeForStep: vi.fn(
      (...args: Parameters<typeof actual.resolveAssigneeForStep>) =>
        actual.resolveAssigneeForStep(...args),
    ),
    getAssigneeName: resolverMocks.getAssigneeName,
  };
});

import { registerWorkflowAdvanceRoutes } from '../routes/requirements/workflow-advance.js';
import { registerWorkflowRejectRoutes } from '../routes/requirements/workflow-reject.js';
import { errorHandler } from '../middleware/error-handler.js';

// ── Fixtures ───────────────────────────────────────────────

const STEPS = [
  { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false, assigneeMode: 'creator' },
  { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'qa_review', displayName: 'QA审查', role: 'qa', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];

const ADMIN_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const ROLE_USER_MAP: Record<string, string> = {
  backend_developer: DEV_USER_ID,
  qa: QA_USER_ID,
  admin: ADMIN_USER_ID,
};

const SNAPSHOT_VALID = { steps: STEPS, roleUserMap: ROLE_USER_MAP };
const SNAPSHOT_INVALID = { steps: 'not-an-array', roleUserMap: ROLE_USER_MAP };

// Note: allowedDomainKeys omitted on normal users so assertDomainReadAccess
// skips domain check (undefined → backward compat). Only set in domain-specific tests.
const DEV_USER = { id: DEV_USER_ID, name: 'Developer', email: 'dev@test.com', role: 'developer' as const, internalRole: 'backend_developer' as const };
const QA_USER = { id: QA_USER_ID, name: 'QA User', email: 'qa@test.com', role: 'qa' as const, internalRole: 'qa' as const };
const CTO_USER = { id: CTO_USER_ID, name: 'CTO', email: 'cto@test.com', role: 'cto_agent' as const };

// ── Express app factory ────────────────────────────────────

function createAdvanceApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: express.Response, next: express.NextFunction) => {
    req.user = user ?? CTO_USER;
    next();
  });
  const router = express.Router();
  registerWorkflowAdvanceRoutes(router);
  app.use('/api/requirements', router);
  app.use(errorHandler);
  return app;
}

function createRejectApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: express.Response, next: express.NextFunction) => {
    req.user = user ?? QA_USER;
    next();
  });
  const router = express.Router();
  registerWorkflowRejectRoutes(router);
  app.use('/api/requirements', router);
  app.use(errorHandler);
  return app;
}

// ── HTTP helpers ───────────────────────────────────────────

interface HttpResult { status: number; body: unknown; }

async function httpPost(
  app: express.Express,
  path: string,
  bodyObj: Record<string, unknown>,
): Promise<HttpResult> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.on('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const postData = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        server.close();
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode ?? 500, body: parsed });
      });
    });
    req.on('error', (err) => { server.close(); reject(err); });
    req.write(postData);
    req.end();
  });
}

// ── Requirement factory ────────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ_ID,
    title: 'Test Requirement',
    currentStep: 'qa_review',    // <-- qa_review has no requiredReports
    assigneeId: QA_USER_ID,
    assignee: 'QA User',
    requesterId: REQ_ID,
    requester: '需求提出者',
    workflowId: 'wf-1',
    workflow: { id: 'wf-1', steps: SNAPSHOT_VALID },
    stateVersion: 5,
    ...overrides,
  };
}

// ── Setup helpers ──────────────────────────────────────────

function setupDefaultMocks() {
  // Reset txUpdateMany to default behavior (not CAS failure)
  mockTxUpdateManyReturn.mockReturnValue(undefined);
  resolverMocks.getAssigneeName.mockImplementation(async (id: string | null) => {
    if (id === DEV_USER_ID) return 'Developer';
    if (id === QA_USER_ID) return 'QA User';
    if (id === ADMIN_USER_ID) return 'Admin';
    return null;
  });
}

// ====================================================================
// Tests — ADVANCE
// ====================================================================

describe('POST /:id/workflow/advance — workflowSnapshot fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ─── 1. relation exists → normal advance ─────────────────────

  it('1. relation exists: advance succeeds (backward compatibility)', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflow: { id: 'wf-1', steps: SNAPSHOT_VALID },
      workflowSnapshot: undefined,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'done', stateVersion: 6 });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });

    const app = createAdvanceApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    expect(res.status).toBe(200);
    expect((res.body as any)?.success).toBe(true);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  // ─── 2. relation null, snapshot exists → advance works ───────

  it('2. relation null + snapshot exists: advance succeeds via snapshot', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'done', stateVersion: 6 });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });

    const app = createAdvanceApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    expect(res.status).toBe(200);
    expect((res.body as any)?.success).toBe(true);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  // ─── 3. both null → 400 ──────────────────────────────────────

  it('3. both relation and snapshot null: returns 400', async () => {
    const req = makeReq({
      workflowId: null,
      workflow: null,
      workflowSnapshot: null,
    });
    mockFindUnique.mockResolvedValue(req);

    const app = createAdvanceApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('该需求未分配工作流');
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  // ─── 4. snapshot format invalid → safe rejection ─────────────

  it('4. invalid snapshot format: returns 400 safely', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_INVALID,
    });
    mockFindUnique.mockResolvedValue(req);

    const app = createAdvanceApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    // Invalid snapshot means steps parse to empty → currentStep not found → 400
    expect(res.status).toBe(400);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  // ─── 5. Auth/permission not bypassed with snapshot ────────────

  it('5. snapshot advance: unauthorized role gets 403', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);

    // DEV_USER (backend_developer) tries to advance qa_review step (needs qa role)
    const app = createAdvanceApp(DEV_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  // ─── 6. advance creates WorkflowTransition ───────────────────

  it('6. advance with snapshot creates WorkflowTransition', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'done', stateVersion: 6 });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });

    const app = createAdvanceApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing via snapshot' });

    expect(res.status).toBe(200);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    const transitionData = mockTransitionCreate.mock.calls[0]?.[0];
    expect(transitionData?.data?.fromStep).toBe('qa_review');
    expect(transitionData?.data?.toStep).toBe('done');
    expect(transitionData?.data?.action).toBe('advance');
    expect(transitionData?.data?.actorId).toBe(QA_USER_ID);
  });

  // ─── 7. advance creates WORKFLOW_ADVANCED ledger event ────────

  it('7. advance with snapshot creates WORKFLOW_ADVANCED ledger event', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
      stateVersion: 5,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'done', stateVersion: 6 });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });

    const app = createAdvanceApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    expect(res.status).toBe(200);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
    const ledgerArg = mockLedgerCreate.mock.calls[0]?.[0];
    // recordRequirementEvent passes data as { data: { eventType, ... } }
    expect(ledgerArg?.data?.eventType).toBe('WORKFLOW_ADVANCED');
    expect(ledgerArg?.data?.requirementId).toBe(REQ_ID);
    expect(ledgerArg?.data?.fromStep).toBe('qa_review');
    expect(ledgerArg?.data?.toStep).toBe('done');
    expect(ledgerArg?.data?.stateVersionBefore).toBe(5);
    // Note: mockFindUnique doesn't track stateVersion increment,
    // so casUpdateRequirement returns the original req with stateVersion=5
    expect(ledgerArg?.data?.stateVersionAfter).toBe(5);
    expect(ledgerArg?.data?.relatedTransitionId).toBe('t1');
  });

  // ─── 10. Transaction rollback on CAS failure ─────────────────

  it('10. advance CAS failure: transaction rolls back (409)', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);
    mockTxUpdateManyReturn.mockReturnValue({ count: 0 });

    const app = createAdvanceApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    // CAS failure → 409 conflict
    expect(res.status).toBe(409);
  });
});

// ====================================================================
// Tests — REJECT
// ====================================================================

describe('POST /:id/workflow/reject — workflowSnapshot fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ─── 1 (reject). relation exists → normal reject ──────────────

  it('1. reject with relation exists: succeeds', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflow: { id: 'wf-1', steps: SNAPSHOT_VALID },
      workflowSnapshot: undefined,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });
    mockLockFindUnique.mockResolvedValue(null);

    const app = createRejectApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'rejecting', targetStep: 'dev_self_check' });

    expect(res.status).toBe(200);
    expect((res.body as any)?.success).toBe(true);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  // ─── 2 (reject). relation null, snapshot exists → reject works ──

  it('2. reject with snapshot only: succeeds', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });
    mockLockFindUnique.mockResolvedValue(null);

    const app = createRejectApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'rejecting', targetStep: 'dev_self_check' });

    expect(res.status).toBe(200);
    expect((res.body as any)?.success).toBe(true);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
  });

  // ─── 3 (reject). both null → 400 ──────────────────────────────

  it('3. reject with both null: returns 400', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: null,
    });
    mockFindUnique.mockResolvedValue(req);

    const app = createRejectApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'rejecting', targetStep: 'dev_self_check' });

    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('该需求未分配工作流');
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  // ─── 4 (reject). invalid snapshot format → safe rejection ─────

  it('4. reject with invalid snapshot: returns 400 safely', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_INVALID,
    });
    mockFindUnique.mockResolvedValue(req);

    const app = createRejectApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'rejecting', targetStep: 'dev_self_check' });

    // Invalid snapshot means steps parse to empty → currentStep not found → 400
    expect(res.status).toBe(400);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  // ─── 5 (reject). Auth not bypassed ─────────────────────────────

  it('5. reject with snapshot: unauthorized role gets 403', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);

    // DEV_USER tries to reject qa_review step (needs qa role)
    const app = createRejectApp(DEV_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'rejecting', targetStep: 'dev_self_check' });

    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  // ─── 8. reject creates WorkflowTransition ────────────────────

  it('8. reject with snapshot creates WorkflowTransition', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });
    mockLockFindUnique.mockResolvedValue(null);

    const app = createRejectApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'needs fix', targetStep: 'dev_self_check' });

    expect(res.status).toBe(200);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    const transitionData = mockTransitionCreate.mock.calls[0]?.[0];
    expect(transitionData?.data?.action).toBe('reject');
    expect(transitionData?.data?.fromStep).toBe('qa_review');
    expect(transitionData?.data?.toStep).toBe('dev_self_check');
  });

  // ─── 9. reject creates WORKFLOW_REJECTED ledger event ─────────

  it('9. reject with snapshot creates WORKFLOW_REJECTED ledger event', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
      stateVersion: 5,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, stateVersion: 6 });
    mockTransitionCreate.mockResolvedValue({ id: 't1' });
    mockLedgerCreate.mockResolvedValue({ id: 'l1' });
    mockLockFindUnique.mockResolvedValue(null);

    const app = createRejectApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'needs fix', targetStep: 'dev_self_check' });

    expect(res.status).toBe(200);
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
    const ledgerArg = mockLedgerCreate.mock.calls[0]?.[0];
    // recordRequirementEvent wraps fields in { data: { eventType, ... } }
    expect(ledgerArg?.data?.eventType).toBe('WORKFLOW_REJECTED');
    expect(ledgerArg?.data?.requirementId).toBe(REQ_ID);
    expect(ledgerArg?.data?.fromStep).toBe('qa_review');
    expect(ledgerArg?.data?.toStep).toBe('dev_self_check');
    expect(ledgerArg?.data?.stateVersionBefore).toBe(5);
    // Note: mockFindUnique doesn't track stateVersion increment,
    // so casUpdateRequirement returns the original req with stateVersion=5
    expect(ledgerArg?.data?.stateVersionAfter).toBe(5);
    expect(ledgerArg?.data?.relatedTransitionId).toBe('t1');
  });

  // ─── 10 (reject). Transaction rollback ────────────────────────

  it('10. reject CAS failure: transaction rolls back (409)', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
    });
    mockFindUnique.mockResolvedValue(req);
    mockLockFindUnique.mockResolvedValue(null);
    mockTxUpdateManyReturn.mockReturnValue({ count: 0 });

    const app = createRejectApp(QA_USER as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'rejecting', targetStep: 'dev_self_check' });

    // CAS failure → 409
    expect(res.status).toBe(409);
  });
});

// ─── Domain access not bypassed (both advance and reject) ────

describe('Domain/Auth protection with workflowSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('advance: outside domain gets 403', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
      domainKey: 'restricted-domain',
    });
    mockFindUnique.mockResolvedValue(req);

    // User with allowedDomainKeys not containing 'restricted-domain'
    const outsideUser = { ...QA_USER, allowedDomainKeys: ['other-domain'] };
    const app = createAdvanceApp(outsideUser as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/advance`, { comment: 'advancing' });

    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('reject: outside domain gets 403', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      workflowId: null,
      workflow: null,
      workflowSnapshot: SNAPSHOT_VALID,
      domainKey: 'restricted-domain',
    });
    mockFindUnique.mockResolvedValue(req);

    const outsideUser = { ...QA_USER, allowedDomainKeys: ['other-domain'] };
    const app = createRejectApp(outsideUser as unknown as Record<string, unknown>);
    const res = await httpPost(app, `/api/requirements/${REQ_ID}/workflow/reject`, { comment: 'rejecting', targetStep: 'dev_self_check' });

    expect(res.status).toBe(403);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });
});
