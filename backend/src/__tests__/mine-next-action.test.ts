/**
 * Route-level tests for GET /mine nextAction correctness (round 2).
 *
 * Execution through production router + production authRequired:
 *   HTTP → Express → requirementsRouter (authRequired) → core-mine → mocked Prisma
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const DEV_USER_ID = '11111111-1111-1111-1111-111111111111';
const QA_USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_USER_ID = '33333333-3333-3333-3333-333333333333';
const CTO_USER_ID = '44444444-4444-4444-4444-444444444444';
const ARCH_USER_ID = '55555555-5555-5555-5555-555555555555';
const OPS_USER_ID = '66666666-6666-6666-6666-666666666666';

const { mockFindMany, mockCount, mockJwtVerify, mockUserFindUnique, mockBindingFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(), mockCount: vi.fn(), mockJwtVerify: vi.fn(), mockUserFindUnique: vi.fn(),
  mockBindingFindMany: vi.fn(),
}));

vi.mock('jsonwebtoken', () => ({ default: { verify: mockJwtVerify }, verify: mockJwtVerify }));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: { findMany: mockFindMany, count: mockCount },
    user: { findUnique: mockUserFindUnique },
    domainRoleBinding: { findMany: mockBindingFindMany },
    businessDomain: {},
    $transaction: vi.fn(async (qs: any[]) => Promise.all(qs.map((q: any) => {
      if (typeof q === 'object' && q !== null && (q.include !== undefined || q.select !== undefined || q.where !== undefined)) return mockFindMany();
      if (typeof q === 'function') return q();
      return q;
    }))),
  },
}));

import { requirementsRouter } from '../routes/requirements/index.js';
import { errorHandler } from '../middleware/error-handler.js';

// Global domain binding: return a global binding for any platform role
function setupDomain() {
  mockBindingFindMany.mockImplementation(async (args: any) => {
    const roles = args?.where?.role?.in ?? [];
    return roles.map((role: string) => ({ role, domainKey: 'engineering', isDomainAdmin: false, isGlobal: true }));
  });
}

const DEV_STEP = { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false, assigneeMode: 'role-based' };
const ARCH_STEP = { name: 'arch_design', displayName: '架构设计', role: 'architect', requiredReports: ['ARCH_DESIGN'], autoAdvance: false, assigneeMode: 'role-based' };
const QA_STEP = { name: 'qa_review', displayName: 'QA审查', role: 'qa', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false, assigneeMode: 'role-based' };
const TESTING_STEP = { name: 'testing', displayName: '测试', role: 'tester', requiredReports: [], autoAdvance: false };
const SECURITY_STEP = { name: 'security_review', displayName: '安全审查', role: 'security', requiredReports: [], autoAdvance: false };
const MERGE_STEP = { name: 'merge_to_main', displayName: '合并', role: 'ops', requiredReports: ['MERGE_REPORT'], autoAdvance: false, assigneeMode: 'role-based' };
const CTO_STEP = { name: 'cto_review', displayName: 'CTO验收', role: 'cto', requiredReports: [], autoAdvance: false };
const DONE = { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false };
const STEPS = [ARCH_STEP, DEV_STEP, QA_STEP, TESTING_STEP, SECURITY_STEP, MERGE_STEP, CTO_STEP, DONE];
const WORKFLOW = { steps: STEPS, roleUserMap: {} };

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/requirements', requirementsRouter);
  app.use(errorHandler);
  return app;
}

function setupAuth(userId: string, overrides: Record<string, unknown> = {}) {
  mockJwtVerify.mockReturnValue({ sub: userId });
  mockUserFindUnique.mockResolvedValue({ id: userId, name: 'T', email: 't@t.com', role: 'developer', internalRole: 'backend_developer', enabled: true, ...overrides });
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1', title: '需求标题', description: '描述', priority: 'P2',
    requester: '开发者', department: '研发部', currentStep: 'qa_review', status: 'qa_review',
    assignee: null, assigneeId: DEV_USER_ID, requesterId: DEV_USER_ID, type: 'FEATURE',
    workflowId: 'wf-1', workflow: WORKFLOW, workflowSnapshot: null,
    gitHash: null, deployVersion: null, branch: null, repoPath: null, rejectReason: null,
    notes: null, attachment: null, dependsOnIds: [], blockedBy: [], stateVersion: 0,
    dueDate: null, tags: [], projectId: null,
    tasks: [], assigneeUser: null, reports: [],
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

interface Res { status: number; body: any; }

async function get(path: string): Promise<Res> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(r => server.on('listening', r));
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET', headers: { Authorization: 'Bearer t' } }, (res) => {
      let data = '';
      res.on('data', (c: string) => data += c);
      res.on('end', () => { server.close(); let b: any; try { b = JSON.parse(data); } catch { b = data; } resolve({ status: res.statusCode ?? 500, body: b }); });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /mine — nextAction (round 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDomain(); });

  // ── P0: Missing reports must be RECONCILE, not WAIT ──

  it('developer missing DEV_SELF_CHECK → RECONCILE, not WAIT', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: DEV_USER_ID, currentStep: 'dev_self_check', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('RECONCILE_CURRENT_STEP');
    expect(res.body.data[0].nextAction).not.toMatch(/等待提交|等待别人|条件已满足|可以advance/);
  });

  it('architect missing ARCH_DESIGN → RECONCILE', async () => {
    setupAuth(ARCH_USER_ID, { internalRole: 'architect' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: ARCH_USER_ID, currentStep: 'arch_design', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('RECONCILE_CURRENT_STEP');
  });

  it('ops missing MERGE_REPORT → RECONCILE', async () => {
    setupAuth(OPS_USER_ID, { internalRole: 'ops' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: OPS_USER_ID, currentStep: 'merge_to_main', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('RECONCILE_CURRENT_STEP');
  });

  // ── QA pending report → REVIEW ──

  it('QA with pending DEV_SELF_CHECK → REVIEW', async () => {
    setupAuth(QA_USER_ID, { internalRole: 'qa' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: QA_USER_ID, currentStep: 'qa_review', reports: [{ id: 'r1', reportType: 'DEV_SELF_CHECK', status: 'pending' }] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('REVIEW_REQUIRED_REPORT');
    expect(res.body.data[0].nextAction).toContain('审查');
  });

  it('QA no report → RECONCILE, not WAIT', async () => {
    setupAuth(QA_USER_ID, { internalRole: 'qa' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: QA_USER_ID, currentStep: 'qa_review', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('RECONCILE_CURRENT_STEP');
  });

  // ── Steps with empty requiredReports → RECONCILE (or FIX_ASSIGNMENT if role mismatch) ──

  it('testing no requiredReports → FIX_ASSIGNMENT (developer ≠ tester) or RECONCILE', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: DEV_USER_ID, currentStep: 'testing', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    const code = res.body.data[0].nextActionCode;
    expect(['FIX_ASSIGNMENT', 'RECONCILE_CURRENT_STEP']).toContain(code);
    expect(code).not.toBe('ADVANCE_CURRENT_STEP');
  });

  it('security_review no requiredReports → FIX_ASSIGNMENT or RECONCILE', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: DEV_USER_ID, currentStep: 'security_review', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    const code = res.body.data[0].nextActionCode;
    expect(['FIX_ASSIGNMENT', 'RECONCILE_CURRENT_STEP']).toContain(code);
    expect(code).not.toBe('ADVANCE_CURRENT_STEP');
  });

  // ── P1: reports minimal select + response isolation ──

  it('reports Prisma select is minimal (id/type/status/createdAt, no content)', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      // Verify reports include uses select with only safe fields
      expect(args.include.reports).toEqual({
        select: { id: true, reportType: true, status: true, createdAt: true },
      });
      return [makeReq({ assigneeId: DEV_USER_ID, currentStep: 'dev_self_check', reports: [] })];
    });
    mockCount.mockResolvedValue(1);
    await get('/api/requirements/mine');
  });

  it('reports key does NOT appear in detail response', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: DEV_USER_ID, currentStep: 'dev_self_check', reports: [{ id: 'r1', reportType: 'DEV_SELF_CHECK', status: 'pending' }] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('reports');
  });

  it('report content sentinel does NOT leak into response', async () => {
    setupAuth(DEV_USER_ID);
    // Even though mock returns sensitive fields, they must not reach HTTP body
    mockFindMany.mockResolvedValue([makeReq({
      assigneeId: DEV_USER_ID, currentStep: 'dev_self_check',
      reports: [{
        id: 'r1', reportType: 'DEV_SELF_CHECK', status: 'pending',
        content: 'SECRET_CODE_REFERENCE',
        reviewComment: 'SECRET_REVIEW_OPINION',
        qaFindings: 'SECRET_QA_FINDINGS',
      }],
    })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('SECRET_CODE_REFERENCE');
    expect(bodyStr).not.toContain('SECRET_REVIEW_OPINION');
    expect(bodyStr).not.toContain('SECRET_QA_FINDINGS');
  });

  // ── Permission characterization ──

  it('QA not assignee → NONE', async () => {
    setupAuth(QA_USER_ID, { internalRole: 'qa' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: DEV_USER_ID, currentStep: 'qa_review', reports: [{ id: 'r1', reportType: 'DEV_SELF_CHECK', status: 'pending' }] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('NONE');
  });

  it('QA assignee but role mismatch → FIX_ASSIGNMENT', async () => {
    setupAuth(QA_USER_ID, { internalRole: 'qa' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: QA_USER_ID, currentStep: 'cto_review', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('FIX_ASSIGNMENT');
  });

  it('admin no bypass → FIX_ASSIGNMENT for role mismatch', async () => {
    setupAuth(ADMIN_USER_ID, { role: 'admin', internalRole: 'admin' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: ADMIN_USER_ID, currentStep: 'qa_review', reports: [{ id: 'r1', reportType: 'DEV_SELF_CHECK', status: 'pending' }] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('FIX_ASSIGNMENT');
  });

  it('cto_agent bypass → RECONCILE, not ADVANCE', async () => {
    setupAuth(CTO_USER_ID, { role: 'cto_agent', internalRole: 'admin' });
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: QA_USER_ID, currentStep: 'cto_review', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0].nextActionCode).toBe('RECONCILE_CURRENT_STEP');
  });

  // ── Logging ──

  it('log failure does not crash response', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: DEV_USER_ID, currentStep: 'dev_self_check', reports: [] })]); mockCount.mockResolvedValue(1);
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('fail'); });
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
  });

  // ── Backward compatibility ──

  it('response has nextAction, nextActionCode, requiredReports, detail fields', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockResolvedValue([makeReq({ assigneeId: DEV_USER_ID, currentStep: 'dev_self_check', reports: [] })]); mockCount.mockResolvedValue(1);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item).toHaveProperty('nextAction');
    expect(item).toHaveProperty('nextActionCode');
    expect(item).toHaveProperty('requiredReports');
    expect(item).toHaveProperty('description');
  });
});
