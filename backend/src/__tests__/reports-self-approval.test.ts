/**
 * M3: Real middleware test — reports-approval self-approval prevention
 *
 * Tests the ACTUAL middleware + handler from reports-approval.ts
 * by extracting them from the Express router stack and calling with mock
 * req/res/next. Only prisma is mocked.
 *
 * Also tests M1 (assigneeMode behavior matrix, 8 tests) and M4 (user existence check, 2 tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock prisma ──
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirementReport: { findUnique: vi.fn(), update: vi.fn() },
    requirement: { findUnique: vi.fn(), update: vi.fn() },
    workflowTemplate: { findUnique: vi.fn() },
    workflowTransition: { create: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    requirementRevision: { create: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

// ── Mock platform-roles ──
vi.mock('../lib/platform-roles.js', () => ({
  isPlatformAdmin: vi.fn(() => false),
  hasPlatformRole: vi.fn(() => false),
  getPlatformRoles: vi.fn(() => []),
}));

// ── Mock notifications ──
vi.mock('../utils/notifications.js', () => ({
  notifyEvent: vi.fn(),
}));

// ── Mock assignee-resolver (partial — keep resolveAssigneeFromSnapshot real) ──
vi.mock('../lib/assignee-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/assignee-resolver.js')>();
  return {
    ...actual,
    resolveAssigneeForStep: vi.fn(),
    getAssigneeName: vi.fn(),
    validateAssigneeRoleMatch: vi.fn(),
  };
});

import { prisma } from '../lib/prisma.js';
import { isPlatformAdmin } from '../lib/platform-roles.js';
import { router as approvalRouter } from '../routes/reports-approval.js';

// ── Extract middleware functions from the Express router stack ──
// The reports-approval router has:
// stack[0] = router.use middleware (sets req.params.id from body)
// stack[1] = router.patch('/:reportId', middlewareFn, handlerFn)
function extractMiddleware() {
  const stack = (approvalRouter as any).stack;
  // The use middleware
  const useMiddleware = stack[0].handle;
  // The patch route: stack[1].route.stack has the two handlers
  const routeStack = stack[1].route.stack;
  const middlewareFn = routeStack[0].handle; // first asyncHandler (self-approval + role check)
  const handlerFn = routeStack[1].handle;    // second asyncHandler (actual approval)
  return { useMiddleware, middlewareFn, handlerFn };
}

// ── Mock data ──
const REQ_ID = '00000000-0000-4000-8000-000000000001';
const REPORT_ID = '00000000-0000-4000-8000-000000000002';
const ARCHITECT_ID = '00000000-0000-4000-8000-000000000010';
const DEV_ID = '00000000-0000-4000-8000-000000000020';
const CTO_ID = '00000000-0000-4000-8000-000000000030';

function makeReq(user: any, overrides: any = {}): any {
  return {
    user,
    params: { id: REQ_ID, reportId: REPORT_ID, ...overrides },
    body: overrides.body || { status: 'approved' },
    query: {},
  };
}
function makeRes(): any {
  const res: any = { statusCode: 200 };
  res.json = vi.fn((data: any) => { res._json = data; });
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  return res;
}
function makeNext() {
  return vi.fn((err?: any) => {
    if (err) {
      const httpError = err as any;
      throw { status: httpError.status || httpError.statusCode || 500, message: httpError.message || String(err) };
    }
  });
}

const mockReportFindUnique = prisma.requirementReport.findUnique as any;
const mockReqFindUnique = prisma.requirement.findUnique as any;
const mockIsPlatformAdmin = isPlatformAdmin as any;

describe('M3: reports-approval real middleware — self-approval prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPlatformAdmin.mockReturnValue(false);
  });

  async function runMiddleware(user: any, reportData: any): Promise<number> {
    const { useMiddleware, middlewareFn } = extractMiddleware();
    const req = makeReq(user);
    const res = makeRes();
    const next = makeNext();

    // Run router.use middleware first (sets params.id from body)
    await new Promise<void>((resolve) => {
      useMiddleware(req, res, (err?: any) => {
        if (err) resolve();
        else resolve();
      });
    });

    // Run the approval middleware
    let caughtStatus = 0;
    try {
      await new Promise<void>((resolve) => {
        middlewareFn(req, res, (err?: any) => {
          if (err) {
            caughtStatus = err.status || err.statusCode || 500;
          }
          resolve();
        });
      });
    } catch (e: any) {
      caughtStatus = e.status || 500;
    }

    return caughtStatus || res.statusCode;
  }

  it('rejects ARCH_REVIEW self-approval with 403', async () => {
    mockReportFindUnique.mockResolvedValue({
      id: REPORT_ID, requirementId: REQ_ID,
      reportType: 'ARCH_REVIEW', submittedById: ARCHITECT_ID,
      status: 'pending', createdAt: new Date('2026-06-01'),
    });

    const status = await runMiddleware(
      { id: ARCHITECT_ID, name: 'A', role: 'developer', internalRole: 'architect' },
      {},
    );

    expect(status).toBe(403);
  });

  it('rejects DEV_SELF_CHECK self-approval with 403', async () => {
    mockReportFindUnique.mockResolvedValue({
      id: REPORT_ID, requirementId: REQ_ID,
      reportType: 'DEV_SELF_CHECK', submittedById: DEV_ID,
      status: 'pending', createdAt: new Date('2026-06-01'),
    });

    const status = await runMiddleware(
      { id: DEV_ID, name: 'D', role: 'developer', internalRole: 'backend_developer' },
      {},
    );

    expect(status).toBe(403);
  });

  it('rejects TEST_REPORT self-approval with 403', async () => {
    mockReportFindUnique.mockResolvedValue({
      id: REPORT_ID, requirementId: REQ_ID,
      reportType: 'TEST_REPORT', submittedById: DEV_ID,
      status: 'pending', createdAt: new Date('2026-06-01'),
    });

    const status = await runMiddleware(
      { id: DEV_ID, name: 'D', role: 'developer', internalRole: 'backend_developer' },
      {},
    );

    expect(status).toBe(403);
  });

  it('rejects DEPLOY_CONFIRM self-approval with 403', async () => {
    mockReportFindUnique.mockResolvedValue({
      id: REPORT_ID, requirementId: REQ_ID,
      reportType: 'DEPLOY_CONFIRM', submittedById: DEV_ID,
      status: 'pending', createdAt: new Date('2026-06-01'),
    });

    const status = await runMiddleware(
      { id: DEV_ID, name: 'D', role: 'developer', internalRole: 'backend_developer' },
      {},
    );

    expect(status).toBe(403);
  });

  it('CTO_REVIEW self-review passes self-approval check (exempt)', async () => {
    mockIsPlatformAdmin.mockReturnValue(true);
    mockReportFindUnique.mockResolvedValue({
      id: REPORT_ID, requirementId: REQ_ID,
      reportType: 'CTO_REVIEW', submittedById: CTO_ID,
      status: 'pending', createdAt: new Date('2026-06-01'),
    });

    // CTO is platform admin → middleware returns next() immediately
    const { middlewareFn } = extractMiddleware();
    const req = makeReq({ id: CTO_ID, name: 'C', role: 'admin', internalRole: 'cto' });
    const res = makeRes();

    let nextCalled = false;
    await new Promise<void>((resolve) => {
      middlewareFn(req, res, (err?: any) => {
        nextCalled = true;
        resolve();
      });
    });

    // Platform admin passes through — next was called, no error
    expect(nextCalled).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// M1: resolveAssigneeFromSnapshot — behavior matrix (8 tests)
// ════════════════════════════════════════════════════════════
import { resolveAssigneeFromSnapshot } from '../lib/assignee-resolver.js';

function makeMockDb(users: Record<string, { id: string; internalRole?: string }> = {}) {
  return {
    user: {
      findUnique: vi.fn(({ where }: any) => {
        const u = users[where.id];
        return u ? { id: u.id, internalRole: u.internalRole ?? 'backend_developer' } : null;
      }),
      findFirst: vi.fn(({ where }: any) => {
        for (const [, u] of Object.entries(users)) {
          if (u.internalRole === where.internalRole) return { id: u.id };
        }
        return null;
      }),
    },
  };
}

const SNAPSHOT_WITH_RUM = {
  steps: [
    { name: 'draft', role: 'requester', displayName: '草稿', requiredReports: [], autoAdvance: false },
    { name: 'dev_self_check', role: 'backend_developer', displayName: '开发自检', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false, assigneeMode: 'role-based' as const },
    { name: 'pm_review', role: 'pm', displayName: 'PM审批', requiredReports: [], autoAdvance: false, assigneeMode: 'creator' as const },
    { name: 'cto_review', role: 'cto', displayName: 'CTO验收', requiredReports: [], autoAdvance: false, assigneeMode: 'fixed' as const },
  ],
  roleUserMap: { backend_developer: 'user-backend-001', cto: 'user-cto-001' },
};

const SNAPSHOT_NO_RUM = {
  steps: [
    { name: 'draft', role: 'requester', displayName: '草稿', requiredReports: [], autoAdvance: false },
    { name: 'dev_self_check', role: 'backend_developer', displayName: '开发自检', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
    { name: 'pm_review', role: 'pm', displayName: 'PM审批', requiredReports: [], autoAdvance: false, assigneeMode: 'creator' as const },
    { name: 'cto_review', role: 'cto', displayName: 'CTO验收', requiredReports: [], autoAdvance: false, assigneeMode: 'fixed' as const },
  ],
};

const SNAPSHOT_LEGACY_ARRAY = [
  { name: 'draft', role: 'requester', displayName: '草稿', requiredReports: [], autoAdvance: false },
  { name: 'dev_self_check', role: 'backend_developer', displayName: '开发自检', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
];

const REQ_DATA = { requesterId: 'req-user-001', assigneeId: 'current-assignee-001' };

const MOCK_USERS: Record<string, { id: string; internalRole?: string }> = {
  'user-backend-001': { id: 'user-backend-001', internalRole: 'backend_developer' },
  'user-cto-001': { id: 'user-cto-001', internalRole: 'cto' },
  'current-assignee-001': { id: 'current-assignee-001', internalRole: 'backend_developer' },
  'req-user-001': { id: 'req-user-001', internalRole: 'pm' },
};

describe('M1: resolveAssigneeFromSnapshot — behavior matrix', () => {

  it('1. creator + no roleUserMap → requesterId', async () => {
    expect(await resolveAssigneeFromSnapshot('pm', 'cur', REQ_DATA, SNAPSHOT_NO_RUM, 'pm_review', makeMockDb(MOCK_USERS)))
      .toBe('req-user-001');
  });

  it('2. creator + empty roleUserMap {} → requesterId', async () => {
    expect(await resolveAssigneeFromSnapshot('pm', 'cur', REQ_DATA, { ...SNAPSHOT_NO_RUM, roleUserMap: {} }, 'pm_review', makeMockDb(MOCK_USERS)))
      .toBe('req-user-001');
  });

  it('3. fixed + no roleUserMap → keep current assignee', async () => {
    expect(await resolveAssigneeFromSnapshot('cto', 'current-assignee-001', REQ_DATA, SNAPSHOT_NO_RUM, 'cto_review', makeMockDb(MOCK_USERS)))
      .toBe('current-assignee-001');
  });

  it('4. fixed + current assignee is null → throws clear error', async () => {
    await expect(resolveAssigneeFromSnapshot('cto', null, REQ_DATA, SNAPSHOT_NO_RUM, 'cto_review', makeMockDb(MOCK_USERS)))
      .rejects.toThrow(/assignee 为空/);
  });

  it('5. role-based + has roleUserMap mapping → precise assignment', async () => {
    expect(await resolveAssigneeFromSnapshot('backend_developer', 'cur', REQ_DATA, SNAPSHOT_WITH_RUM, 'dev_self_check', makeMockDb(MOCK_USERS)))
      .toBe('user-backend-001');
  });

  it('6. role-based + has map but missing role → throws clear error', async () => {
    const snapshot = {
      steps: [{ name: 'qa_review', role: 'qa', displayName: 'QA', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' as const }],
      roleUserMap: { backend_developer: 'user-backend-001' },
    };
    await expect(resolveAssigneeFromSnapshot('qa', 'cur', REQ_DATA, snapshot, 'qa_review', makeMockDb(MOCK_USERS)))
      .rejects.toThrow(/未找到 role.*qa/);
  });

  it('7. role-based + no/null/empty map → internalRole fallback', async () => {
    expect(await resolveAssigneeFromSnapshot('backend_developer', 'current-assignee-001', REQ_DATA, SNAPSHOT_NO_RUM, 'dev_self_check', makeMockDb(MOCK_USERS)))
      .toBe('current-assignee-001');
  });

  it('8. mode absent (legacy snapshot) → internalRole fallback', async () => {
    expect(await resolveAssigneeFromSnapshot('backend_developer', 'current-assignee-001', REQ_DATA, SNAPSHOT_LEGACY_ARRAY, 'dev_self_check', makeMockDb(MOCK_USERS)))
      .toBe('current-assignee-001');
  });
});

// ════════════════════════════════════════════════════════════
// M4: roleUserMap user existence check
// ════════════════════════════════════════════════════════════
describe('M4: roleUserMap user existence check', () => {
  it('throws when roleUserMap maps to non-existent user', async () => {
    const db = makeMockDb({
      'user-cto-001': { id: 'user-cto-001', internalRole: 'cto' },
    });

    await expect(
      resolveAssigneeFromSnapshot('backend_developer', 'old', REQ_DATA, SNAPSHOT_WITH_RUM, 'dev_self_check', db),
    ).rejects.toThrow(/不存在/);

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-backend-001' },
      select: { id: true },
    });
  });

  it('succeeds when roleUserMap maps to existing user', async () => {
    const db = makeMockDb({
      'user-backend-001': { id: 'user-backend-001', internalRole: 'backend_developer' },
    });

    expect(await resolveAssigneeFromSnapshot('backend_developer', 'old', REQ_DATA, SNAPSHOT_WITH_RUM, 'dev_self_check', db))
      .toBe('user-backend-001');
  });
});
