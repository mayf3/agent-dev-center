/**
 * Route-level tests for workflow-reject.ts — assignee routing with snapshots
 *
 * Execution through real Express routing stack:
 *   app → auth middleware → Zod validation → reject handler → mocked Prisma
 *
 * Two-phase execution guaranteed:
 *   Phase 1 — reads, effectiveRequesterId calculation, resolver, UUID/user/name
 *             validation (NO writes)
 *   Phase 2 — lock release (findUnique + delete), update, transition
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// Valid UUIDs
const UUID = '00000000-0000-0000-0000-000000000001';
const DEV_USER_ID = '11111111-1111-1111-1111-111111111111';
const QA_USER_ID = '22222222-2222-2222-2222-222222222222';
const CTO_USER_ID = '33333333-3333-3333-3333-333333333333';
const DIFFERENT_USER_ID = '44444444-4444-4444-4444-444444444444';
const MISSING_UUID = '55555555-5555-5555-5555-555555555555';
const INVALID_ID_FORMAT = 'not-a-uuid-at-all';
const BACKFILL_USER_ID = '99999999-9999-9999-9999-999999999991';

// ── Hoisted mocks (aligned with production Prisma surface) ────

const {
  mockFindUnique, mockUpdate, mockUpdateMany, mockTransitionCreate,
  mockFindFirst, mockUserFindUnique,
  mockLockFindUnique, mockLockDeleteMany, mockTx,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockTransitionCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockLockFindUnique: vi.fn(),
  mockLockDeleteMany: vi.fn(),
  mockTx: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => {
  // Build a $transaction mock that forwards to a fake tx object.
  // The tx.requirement.updateMany also delegates to mockUpdate to keep
  // backward compatibility with existing test assertions.
  const makeTx = () => {
    const txUpdateMany = vi.fn((args: any) => {
      // Forward to both updateMany (new CAS) and update (legacy assertions)
      mockUpdateMany(args);
      mockUpdate({ where: args.where, data: args.data });
      return { count: 1 };
    });
    return {
      requirement: { findUnique: mockFindUnique, updateMany: txUpdateMany },
      workflowTransition: { create: mockTransitionCreate },
      testEnvLock: { findUnique: mockLockFindUnique, deleteMany: mockLockDeleteMany },
      notification: { create: vi.fn().mockResolvedValue({}) },
      requirementRevision: { create: vi.fn().mockResolvedValue({}) },
    };
  };

  const mockTransaction = vi.fn((cb: (tx: any) => any) => cb(makeTx()));

  return {
    prisma: {
      $transaction: mockTransaction,
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      requirement: { findUnique: mockFindUnique, update: mockUpdate, updateMany: mockUpdateMany },
      user: { findUnique: mockUserFindUnique, findFirst: mockFindFirst },
      workflowTransition: { create: mockTransitionCreate },
      notification: { create: vi.fn().mockResolvedValue({}) },
      workflowTemplate: { findFirst: vi.fn() },
      testEnvLock: { findUnique: mockLockFindUnique, deleteMany: mockLockDeleteMany },
      requirementRevision: { create: vi.fn().mockResolvedValue({}) },
    },
  };
});

// Partial mock: resolveAssigneeForStep is a spy forwarding to the actual resolver.
// getAssigneeName is mocked so we can test user-not-found / error paths.
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

import { registerWorkflowRejectRoutes } from '../routes/requirements/workflow-reject.js';
import { errorHandler } from '../middleware/error-handler.js';
import { resolveAssigneeForStep } from '../lib/assignee-resolver.js';

/** Spy that wraps the actual resolveAssigneeForStep — never mocked with hand-written logic */
const resolveAssigneeSpy = vi.mocked(resolveAssigneeForStep);

// ── Step fixtures ─────────────────────────────────────────────

const SAMPLE_STEPS_ARRAY = [
  { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false, assigneeMode: 'creator' },
  { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'qa_review', displayName: 'QA审查', role: 'qa', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'deploying', displayName: '部署中', role: 'qa', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'cto_review', displayName: 'CTO验收', role: 'cto', requiredReports: [], autoAdvance: false },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];

const SAMPLE_ROLE_USER_MAP: Record<string, string> = {
  backend_developer: DEV_USER_ID,
  qa: QA_USER_ID,
};

const SNAPSHOT_OBJECT_WITH_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: SAMPLE_ROLE_USER_MAP };
const SNAPSHOT_ARRAY_LEGACY = SAMPLE_STEPS_ARRAY;
const SNAPSHOT_OBJECT_NULL_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: null };
const SNAPSHOT_OBJECT_EMPTY_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: {} };
const SNAPSHOT_OBJECT_MISSING_MAP = { steps: SAMPLE_STEPS_ARRAY };
const SNAPSHOT_STRING_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: 'bad-string-map' };
const SNAPSHOT_ARRAY_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: [['dev', DEV_USER_ID]] as any };
const SNAPSHOT_NULL_VALUE_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: { backend_developer: null } };
const SNAPSHOT_NUM_VALUE_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: { backend_developer: 12345 } };
const SNAPSHOT_EMPTY_KEY_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: { '': DEV_USER_ID } };
const SNAPSHOT_WHITESPACE_KEY_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: { ' backend_developer': DEV_USER_ID } };
const SNAPSHOT_WHITESPACE_VAL_MAP = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: { backend_developer: ' ' + DEV_USER_ID } };

// 真实自有 __proto__ / constructor — 用 JSON.parse 构造（JSONB 等价）
const SNAPSHOT_PROTO_KEY_MAP = {
  steps: SAMPLE_STEPS_ARRAY,
  roleUserMap: JSON.parse(`{"__proto__":"${DEV_USER_ID}"}`),
};
const SNAPSHOT_CONSTRUCTOR_KEY_MAP = {
  steps: SAMPLE_STEPS_ARRAY,
  roleUserMap: JSON.parse(`{"constructor":"${DEV_USER_ID}"}`),
};

const LIVE_TEMPLATE_STEPS = { steps: SAMPLE_STEPS_ARRAY, roleUserMap: SAMPLE_ROLE_USER_MAP };
const LIVE_TEMPLATE_NO_MAP = { steps: SAMPLE_STEPS_ARRAY };

const SNAPSHOT_STEPS_ONLY_IN_SNAPSHOT = [
  { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'qa_review', displayName: 'QA审查', role: 'qa', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];

// 独立 fixture：draft step 使用非 requester role + creator mode
// 证明 resolver 必须收到 effectiveRequesterId（而非原始 null）
const NON_REQUESTER_DRAFT_STEPS = [
  { name: 'draft', displayName: '草稿', role: 'backend_developer', requiredReports: [], autoAdvance: false, assigneeMode: 'creator' },
  { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'qa_review', displayName: 'QA审查', role: 'qa', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];
const SNAPSHOT_NON_REQUESTER_DRAFT = {
  steps: NON_REQUESTER_DRAFT_STEPS,
  roleUserMap: SAMPLE_ROLE_USER_MAP,
};
const TEMPLATE_STEPS_WITHOUT_DEV = [
  { name: 'qa_review', displayName: 'QA审查', role: 'qa', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];

// ── Express app factory ───────────────────────────────────────

const QA_USER = { id: QA_USER_ID, name: 'QA User', email: 'qa@test.com', role: 'qa' as const, internalRole: 'qa' as const };
const CTO_USER = { id: CTO_USER_ID, name: 'CTO', email: 'cto@test.com', role: 'cto_agent' as const };

function createApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: express.Response, next: express.NextFunction) => {
    req.user = user ?? CTO_USER;
    next();
  });
  const router = express.Router();
  registerWorkflowRejectRoutes(router);
  app.use('/api/requirements', router);
  app.use(errorHandler);
  return app;
}

// ── HTTP helper ───────────────────────────────────────────────

interface RejectResult { status: number; body: unknown; }

async function rejectRequest(
  app: express.Express,
  requirementId: string,
  body: { comment: string; targetStep?: string },
): Promise<RejectResult> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.on('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const postData = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port,
      path: `/api/requirements/${requirementId}/workflow/reject`,
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

// ── Base requirement factory ──────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID, title: '需求标题', currentStep: 'qa_review',
    assigneeId: QA_USER_ID, assignee: 'QA User',
    requesterId: UUID, requester: '需求提出者',
    workflowId: 'wf-1',
    workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_STEPS },
    ...overrides,
  };
}

// ── User mock helper ──────────────────────────────────────────

function setupDefaultUserMock() {
  mockUserFindUnique.mockImplementation(async (args: any) => {
    if (args?.where?.id === DEV_USER_ID) return { id: DEV_USER_ID, name: 'Developer One' };
    if (args?.where?.id === QA_USER_ID) return { id: QA_USER_ID, name: 'QA User' };
    if (args?.where?.id === UUID) return { id: UUID, name: '需求提出者' };
    if (args?.where?.id === CTO_USER_ID) return { id: CTO_USER_ID, name: 'CTO' };
    if (args?.where?.id === DIFFERENT_USER_ID) return { id: DIFFERENT_USER_ID, name: 'Different Dev' };
    if (args?.where?.id === BACKFILL_USER_ID) return { id: BACKFILL_USER_ID, name: 'Backfill Requester' };
    return null;
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe('POST /:id/workflow/reject — assignee routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultUserMock();
    // restoreAssigneeSpy clears calls but preserves the forwarding implementation.
    // No hand-written creator/role-based logic here — all normal tests go through actual resolver.
    resolverMocks.getAssigneeName.mockImplementation(async (id: string | null) => {
      if (!id) return null;
      if (id === DEV_USER_ID) return 'Developer One';
      if (id === QA_USER_ID) return 'QA User';
      if (id === UUID) return '需求提出者';
      if (id === CTO_USER_ID) return 'CTO';
      if (id === DIFFERENT_USER_ID) return 'Different Dev';
      if (id === BACKFILL_USER_ID) return 'Backfill Requester';
      // If an unknown or missing ID is queried, return null so the handler
      // can test the user-not-found fail-closed path.
      return null;
    });
  });

  // ── 正常路由 / 数据源 ───────────────────────────────────────

  it('object snapshot + valid roleUserMap: assignee updated, transition written', async () => {
    const req = makeReq({ workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);

    const res = await rejectRequest(app, UUID, { comment: '需要修改', targetStep: 'dev_self_check' });

    expect(res.status).toBe(200);
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    expect(updateCall.data).toMatchObject({ currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
  });

  it('legacy array snapshot + template map: steps from snapshot, map from template', async () => {
    const req = makeReq({ workflowSnapshot: SNAPSHOT_ARRAY_LEGACY, workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_STEPS } });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix it', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
  });

  it('snapshot map null/missing/empty + template has map: fallback to template', async () => {
    for (const snap of [SNAPSHOT_OBJECT_NULL_MAP, SNAPSHOT_OBJECT_MISSING_MAP, SNAPSHOT_OBJECT_EMPTY_MAP]) {
      vi.clearAllMocks();
      setupDefaultUserMock();
      const req = makeReq({ workflowSnapshot: snap, workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_STEPS } });
      mockFindUnique.mockResolvedValue(req);
      mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
      mockTransitionCreate.mockResolvedValue({});
      const app = createApp(QA_USER as unknown as Record<string, unknown>);
      const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
      expect(res.status).toBe(200);
      expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
    }
  });

  it('snapshot steps source: target step exists in snapshot but NOT in template', async () => {
    const req = makeReq({
      currentStep: 'qa_review', assigneeId: QA_USER_ID,
      workflowSnapshot: SNAPSHOT_STEPS_ONLY_IN_SNAPSHOT,
      workflow: { id: 'wf-1', steps: { steps: TEMPLATE_STEPS_WITHOUT_DEV, roleUserMap: SAMPLE_ROLE_USER_MAP } },
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.currentStep).toBe('dev_self_check');
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
  });

  it('snapshot own roleUserMap NOT overridden by template map', async () => {
    const snapshotMap = { backend_developer: DIFFERENT_USER_ID, qa: QA_USER_ID };
    const req = makeReq({ workflowSnapshot: { steps: SAMPLE_STEPS_ARRAY, roleUserMap: snapshotMap } });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DIFFERENT_USER_ID, assignee: 'Different Dev' });
    mockTransitionCreate.mockResolvedValue({});
    mockUserFindUnique.mockImplementation(async (args: any) => {
      if (args?.where?.id === DIFFERENT_USER_ID) return { id: DIFFERENT_USER_ID, name: 'Different Dev' };
      if (args?.where?.id === QA_USER_ID) return { id: QA_USER_ID, name: 'QA User' };
      return null;
    });
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DIFFERENT_USER_ID);
  });

  it('existing reject contract: default target + transition metadata', async () => {
    const req = makeReq({ currentStep: 'qa_review', assigneeId: QA_USER_ID, workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockImplementation(async (args: any) => ({ ...req, ...args.data }));
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: '不符合标准' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.currentStep).toBe('dev_self_check');
    expect(mockTransitionCreate.mock.calls[0]?.[0].data.action).toBe('reject');
    expect(mockTransitionCreate.mock.calls[0]?.[0].data.actorId).toBe(QA_USER_ID);
  });

  it('success writes assigneeId + assignee name together', async () => {
    const req = makeReq({ workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockImplementation(async (args: any) => ({ ...req, ...args.data }));
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: '需要修改', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
    expect(mockUpdate.mock.calls[0]?.[0].data.assignee).toBe('Developer One');
  });

  // ── Fail-closed: roleUserMap / role / resolver ──────────────

  it('both snapshot + template lack valid roleUserMap: 400, no writes', async () => {
    const req = makeReq({ workflowSnapshot: SNAPSHOT_ARRAY_LEGACY, workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_NO_MAP } });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  it('target role not in roleUserMap: 400, no writes', async () => {
    const limitedMap = { ...SAMPLE_ROLE_USER_MAP };
    delete (limitedMap as any).backend_developer;
    const req = makeReq({
      workflowSnapshot: { steps: SAMPLE_STEPS_ARRAY, roleUserMap: limitedMap },
      workflow: { id: 'wf-1', steps: { steps: SAMPLE_STEPS_ARRAY, roleUserMap: limitedMap } },
    });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  it('resolver throws (no map): 400, no writes, stable error', async () => {
    const req = makeReq({ workflowSnapshot: null, workflow: { id: 'wf-1', steps: { steps: SAMPLE_STEPS_ARRAY } } });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  it('both snapshot + template have invalid map: 400, no writes', async () => {
    const req = makeReq({
      workflowSnapshot: SNAPSHOT_STRING_MAP,
      workflow: { id: 'wf-1', steps: { steps: SAMPLE_STEPS_ARRAY, roleUserMap: 'bad-template-map' } },
    });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  // ── Fail-closed: mapped ID / user / name ────────────────────

  it('mapped ID invalid format: 400, no writes, stable error, no leak', async () => {
    const badMap = { backend_developer: INVALID_ID_FORMAT, qa: QA_USER_ID };
    const req = makeReq({ workflowSnapshot: { steps: SAMPLE_STEPS_ARRAY, roleUserMap: badMap } });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    const body = res.body as any;
    expect(body?.message).toContain('目标步骤负责人配置无效');
    expect(body?.message).not.toContain('not-a-uuid');
    expect(body?.message).not.toContain(DEV_USER_ID);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  it('mapped ID valid UUID but user not found: 400, no writes', async () => {
    const badMap = { backend_developer: MISSING_UUID, qa: QA_USER_ID };
    const req = makeReq({ workflowSnapshot: { steps: SAMPLE_STEPS_ARRAY, roleUserMap: badMap } });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  it('getAssigneeName throws: 400, no writes, stable error', async () => {
    const req = makeReq({ workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP });
    mockFindUnique.mockResolvedValue(req);
    resolverMocks.getAssigneeName.mockRejectedValueOnce(new Error('DB connection lost'));
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    const body = res.body as any;
    expect(body?.message).toContain('目标步骤负责人配置无效');
    expect(body?.message).not.toContain('DB connection lost');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  // ── roleUserMap 类型异常 → template fallback（表驱动） ─────

  it.each([
    ['string', SNAPSHOT_STRING_MAP],
    ['array', SNAPSHOT_ARRAY_MAP],
    ['null value', SNAPSHOT_NULL_VALUE_MAP],
    ['numeric value', SNAPSHOT_NUM_VALUE_MAP],
    ['empty key', SNAPSHOT_EMPTY_KEY_MAP],
  ])('snapshot map is %s (invalid), template has valid map → fallback', async (_label, snap) => {
    const req = makeReq({ workflowSnapshot: snap, workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_STEPS } });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
  });

  // ── 安全加固 — whitespace / 危险 prototype keys ─────────────
  // __proto__ 和 constructor 使用 JSON.parse 构造真实自有属性

  it.each([
    ['whitespace-prefixed key', SNAPSHOT_WHITESPACE_KEY_MAP],
    ['whitespace-prefixed value', SNAPSHOT_WHITESPACE_VAL_MAP],
  ])('snapshot map has %s → fallback to template', async (_label, snap) => {
    const req = makeReq({ workflowSnapshot: snap, workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_STEPS } });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
  });

  it('snapshot map has real own __proto__ key (JSON.parse) → fallback to template', async () => {
    expect(Object.prototype.hasOwnProperty.call(SNAPSHOT_PROTO_KEY_MAP.roleUserMap, '__proto__')).toBe(true);
    const req = makeReq({ workflowSnapshot: SNAPSHOT_PROTO_KEY_MAP, workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_STEPS } });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
  });

  it('snapshot map has real own constructor key (JSON.parse) → fallback to template', async () => {
    expect(Object.prototype.hasOwnProperty.call(SNAPSHOT_CONSTRUCTOR_KEY_MAP.roleUserMap, 'constructor')).toBe(true);
    const req = makeReq({ workflowSnapshot: SNAPSHOT_CONSTRUCTOR_KEY_MAP, workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_STEPS } });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue({ ...req, currentStep: 'dev_self_check', assigneeId: DEV_USER_ID, assignee: 'Developer One' });
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0]?.[0].data.assigneeId).toBe(DEV_USER_ID);
  });

  it('snapshot has own __proto__ + template invalid/missing: 400, no writes', async () => {
    expect(Object.prototype.hasOwnProperty.call(SNAPSHOT_PROTO_KEY_MAP.roleUserMap, '__proto__')).toBe(true);
    const req = makeReq({
      workflowSnapshot: SNAPSHOT_PROTO_KEY_MAP,
      workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_NO_MAP },
    });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);
    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });
    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  // ── Lock 失败路径：真实 protected→unprotected，assignee 失败 ─

  it('lock path (deploying → qa_review) + assignee fails: 400, lock findUnique=0, delete=0, update=0, transition=0', async () => {
    const req = makeReq({
      currentStep: 'deploying',
      assigneeId: QA_USER_ID,
      workflowSnapshot: SNAPSHOT_ARRAY_LEGACY,
      workflow: { id: 'wf-1', steps: LIVE_TEMPLATE_NO_MAP },
    });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(QA_USER as unknown as Record<string, unknown>);

    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'qa_review' });

    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  // ── Lock 成功路径：真实 findUnique + delete ──────────────────

  it('lock path (deploying → dev_self_check) success: findUnique + delete + update + transition in order', async () => {
    const req = makeReq({
      currentStep: 'deploying',
      assigneeId: QA_USER_ID,
      workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP,
    });
    mockFindUnique.mockResolvedValue(req);
    mockLockFindUnique.mockResolvedValue({ id: 'singleton', requirementId: UUID, lockToken: 'test-token' });
    mockLockDeleteMany.mockResolvedValue({});
    mockUpdate.mockImplementation(async (args: any) => ({ ...req, ...args.data }));
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(QA_USER as unknown as Record<string, unknown>);

    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'dev_self_check' });

    expect(res.status).toBe(200);
    expect(mockLockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockLockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'singleton' }) }));
    expect(mockLockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockLockDeleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'singleton' }) }));

    // 完整调用顺序：findUnique < delete < update < transition
    const findOrder = mockLockFindUnique.mock.invocationCallOrder[0];
    const deleteOrder = mockLockDeleteMany.mock.invocationCallOrder[0];
    const updateOrder = mockUpdate.mock.invocationCallOrder[0];
    const transitionOrder = mockTransitionCreate.mock.invocationCallOrder[0];

    expect(findOrder).toBeLessThan(deleteOrder);
    expect(deleteOrder).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan(transitionOrder);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockTransitionCreate.mock.calls[0]?.[0].data.fromStep).toBe('deploying');
    expect(mockTransitionCreate.mock.calls[0]?.[0].data.toStep).toBe('dev_self_check');
  });

  // ── Draft + effectiveRequesterId 在 resolver 前计算 ────────

  it('draft with null requesterId + backfill: effectiveRequesterId computed before resolver, single update', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      requesterId: null,
      requester: 'Backfill Requester',
      workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP,
    });
    mockFindUnique.mockResolvedValue(req);
    mockFindFirst.mockResolvedValue({ id: BACKFILL_USER_ID, name: 'Backfill Requester' });
    mockUpdate.mockImplementation(async (args: any) => ({ ...req, ...args.data }));
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(CTO_USER);

    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'draft' });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateData = mockUpdate.mock.calls[0]?.[0].data;
    expect(updateData.currentStep).toBe('draft');
    expect(updateData.assigneeId).toBe(BACKFILL_USER_ID);
    expect(updateData.assignee).toBe('Backfill Requester');
    expect(updateData.requesterId).toBe(BACKFILL_USER_ID);
  });

  it('draft with null requesterId + backfill + name lookup fails: 400, no pre-write, no lock, no update, no transition', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      requesterId: null,
      requester: 'Backfill Requester',
      workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP,
    });
    mockFindUnique.mockResolvedValue(req);
    mockFindFirst.mockResolvedValue({ id: BACKFILL_USER_ID, name: 'Backfill Requester' });
    resolverMocks.getAssigneeName.mockImplementation(async (id: string | null) => {
      if (id === QA_USER_ID) return 'QA User';
      return null; // BACKFILL_USER_ID → not found
    });
    const app = createApp(CTO_USER);

    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'draft' });

    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockLockFindUnique).not.toHaveBeenCalled();
    expect(mockLockDeleteMany).not.toHaveBeenCalled();
  });

  it('draft with null requesterId + no requester name: 400, no writes', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      requesterId: null,
      requester: null,
      workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP,
    });
    mockFindUnique.mockResolvedValue(req);
    const app = createApp(CTO_USER);

    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'draft' });

    expect(res.status).toBe(400);
    expect((res.body as any)?.message).toContain('目标步骤负责人配置无效');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('draft with existing requesterId: no backfill needed, single update', async () => {
    const req = makeReq({
      currentStep: 'qa_review',
      assigneeId: QA_USER_ID,
      requesterId: UUID,
      requester: '需求提出者',
      workflowSnapshot: SNAPSHOT_OBJECT_WITH_MAP,
    });
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockImplementation(async (args: any) => ({ ...req, ...args.data }));
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp(CTO_USER);

    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'draft' });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateData = mockUpdate.mock.calls[0]?.[0].data;
    expect(updateData.currentStep).toBe('draft');
    expect(updateData.assigneeId).toBe(UUID);
    expect(updateData.assignee).toBe('需求提出者');
    expect(updateData.requesterId).toBeUndefined();
  });

  it('non-requester role + creator mode target draft: resolver receives computed requesterId, reject succeeds', async () => {
    // 独立 fixture：draft role=backend_developer（非 requester），assigneeMode=creator
    const draftStep = NON_REQUESTER_DRAFT_STEPS.find(s => s.name === 'draft')!;
    // fixture 自身断言
    expect(draftStep.role).not.toBe('requester');
    expect(draftStep.role).toBe('backend_developer');
    expect(draftStep.assigneeMode).toBe('creator');

    const req = makeReq({
      currentStep: 'dev_self_check',
      assigneeId: DEV_USER_ID,
      requesterId: null,                 // 原始 requesterId 为空
      requester: 'Backfill Requester',   // 可解析
      workflowSnapshot: SNAPSHOT_NON_REQUESTER_DRAFT,
    });
    mockFindUnique.mockResolvedValue(req);
    mockFindFirst.mockResolvedValue({ id: BACKFILL_USER_ID, name: 'Backfill Requester' });

    mockUpdate.mockImplementation(async (args: any) => ({ ...req, ...args.data }));
    mockTransitionCreate.mockResolvedValue({});
    const app = createApp({ id: CTO_USER_ID, name: 'CTO', email: 'cto@test.com', role: 'cto_agent' as const });

    const res = await rejectRequest(app, UUID, { comment: 'fix', targetStep: 'draft' });

    expect(res.status).toBe(200);

    // 真实 resolver 执行：assigneeMode=creator → 返回 requirement.requesterId (=BACKFILL_USER_ID)
    // spy 证明 resolver 被调用且收到已计算的 effectiveRequesterId
    expect(resolveAssigneeSpy).toHaveBeenCalledTimes(1);
    expect(resolveAssigneeSpy).toHaveBeenCalledWith(
      'backend_developer',
      DEV_USER_ID,
      expect.objectContaining({
        assigneeMode: 'creator',
        requirement: expect.objectContaining({
          requesterId: BACKFILL_USER_ID,
        }),
      }),
    );

    // 单次 update 含所有字段
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateData = mockUpdate.mock.calls[0]?.[0].data;
    expect(updateData.assigneeId).toBe(BACKFILL_USER_ID);
    expect(updateData.assignee).toBe('Backfill Requester');
    expect(updateData.requesterId).toBe(BACKFILL_USER_ID);
    expect(updateData.currentStep).toBe('draft');

    // transition 正常
    expect(mockTransitionCreate).toHaveBeenCalledTimes(1);
    expect(mockTransitionCreate.mock.calls[0]?.[0].data.toStep).toBe('draft');
  });
});
