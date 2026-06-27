/**
 * Route-level tests for GET /mine and GET /requested with view=summary|detail
 *
 * Execution through the PRODUCTION router and authRequired middleware:
 *   HTTP request → Express → requirementsRouter (with authRequired)
 *   → core-list / core-mine / core-requested → mocked Prisma → response
 *
 * The same test file must be copyable to clean Base and still be collected
 * (new-route tests will fail at HTTP level, not at import level).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const DEV_USER_ID = '11111111-1111-1111-1111-111111111111';
const PM_USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';

// ── Mocks (all hoisted, all defined before any real import) ───

const { mockFindMany, mockCount, mockFindUnique, mockUserFindUnique, mockJwtVerify } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockJwtVerify: vi.fn(),
}));

vi.mock('jsonwebtoken', () => ({
  default: { verify: mockJwtVerify },
  verify: mockJwtVerify,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: { findMany: mockFindMany, count: mockCount, findUnique: mockFindUnique },
    user: { findUnique: mockUserFindUnique, findFirst: vi.fn() },
    workflowTransition: { create: vi.fn() },
    notification: { create: vi.fn().mockResolvedValue({}) },
    workflowTemplate: { findFirst: vi.fn() },
    $transaction: vi.fn(async (queries: any[]) => Promise.all(queries.map((q: any) => {
      if (typeof q === 'object' && q !== null && (q.include !== undefined || q.select !== undefined || q.where !== undefined)) {
        return mockFindMany();
      }
      if (typeof q === 'function') return q();
      return q;
    }))),
  },
}));

// Production router — includes authRequired middleware
import { requirementsRouter } from '../routes/requirements/index.js';
import { errorHandler } from '../middleware/error-handler.js';

// ── Factory helpers ───────────────────────────────────────────

/** The exact key set that a summary response item MUST contain (alphabetically sorted). */
const EXPECTED_SUMMARY_KEYS = Object.freeze([
  'assignee', 'assigneeId', 'createdAt', 'currentStep',
  'id', 'priority', 'requester', 'requesterId',
  'status', 'title', 'type', 'updatedAt',
]);

function makeReqFields(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1', title: '需求标题', description: '需求描述',
    priority: 'P2', requester: '开发者', department: '研发部',
    assignee: null, assigneeId: null, requesterId: DEV_USER_ID,
    currentStep: 'submitted', status: 'submitted',
    type: 'FEATURE', gitHash: null, deployVersion: null,
    branch: null, repoPath: null, rejectReason: null,
    notes: null, attachment: null, workflowSnapshot: null,
    dependsOnIds: [], blockedBy: [], stateVersion: 0,
    dueDate: null, tags: [], workflowId: null, projectId: null,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create app with production requirementsRouter and auth mocked via JWT. */
function createApp(userId: string = DEV_USER_ID) {
  const app = express();
  app.use(express.json());
  app.use('/api/requirements', requirementsRouter);
  app.use(errorHandler);
  return app;
}

/** Auth setup: when authRequired runs, jwt.verify succeeds and prisma.user.findUnique returns the user. */
function setupAuth(userId: string, overrides: Record<string, unknown> = {}) {
  mockJwtVerify.mockReturnValue({ sub: userId });
  mockUserFindUnique.mockResolvedValue({
    id: userId,
    name: 'Test User',
    email: 'test@test.com',
    role: 'developer',
    internalRole: 'backend_developer',
    enabled: true,  // authRequired checks this field
    ...overrides,
  });
}

interface ReqResult { status: number; body: any; }

async function getRequest(app: express.Express, path: string, options?: { noAuth?: boolean }): Promise<ReqResult> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.on('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (!options?.noAuth) {
      headers['Authorization'] = 'Bearer test-jwt-token';
    }
    const req = http.request({
      hostname: 'localhost', port, path, method: 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        server.close();
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode ?? 500, body: parsed });
      });
    });
    req.on('error', (err) => { server.close(); reject(err); });
    req.end();
  });
}

function setupDefaultMock() {
  mockFindMany.mockReset();
  mockCount.mockReset();
  mockFindUnique.mockReset();
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
}

// ── Helper: authorization header for authenticated requests ───

function authPath(path: string): string {
  return path; // Tests using createApp require JWT mock via setupAuth
}

// ═══════════════════════════════════════════════════════════════
//  View validation
// ═══════════════════════════════════════════════════════════════

describe('View validation', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMock(); setupAuth(DEV_USER_ID); });

  it('mine no view defaults to detail (200)', async () => {
    const req = makeReqFields({ assigneeId: DEV_USER_ID, assignee: 'Developer' });
    mockFindMany.mockResolvedValue([{ ...req, tasks: [], assigneeUser: null }]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/mine');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('description');
  });

  it('mine view=detail returns same shape as no-view', async () => {
    const req = makeReqFields({ assigneeId: DEV_USER_ID, assignee: 'Developer' });
    mockFindMany.mockResolvedValue([{ ...req, tasks: [], assigneeUser: null }]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res1 = await getRequest(app, '/api/requirements/mine');
    const res2 = await getRequest(app, '/api/requirements/mine?view=detail');
    expect(Object.keys(res1.body.data[0]).sort()).toEqual(Object.keys(res2.body.data[0]).sort());
  });

  it('mine view=summary returns 200', async () => {
    mockFindMany.mockResolvedValue([makeReqFields()]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/mine?view=summary');
    expect(res.status).toBe(200);
  });

  it('requested no view defaults to detail (200)', async () => {
    const req = makeReqFields({ requesterId: DEV_USER_ID });
    mockFindMany.mockResolvedValue([{ ...req, tasks: [], assigneeUser: null, project: null }]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('description');
  });

  it('requested view=summary returns 200', async () => {
    mockFindMany.mockResolvedValue([makeReqFields({ requesterId: DEV_USER_ID })]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested?view=summary');
    expect(res.status).toBe(200);
  });

  // Invalid view MUST return 400, not silently fall back to detail
  it.each([
    ['foo', 'view=foo'],
    ['SUMMARY', 'view=SUMMARY'],
    ['empty string', 'view='],
    ['array-like', 'view=summary&view=detail'],
  ])('mine rejects invalid view: %s → 400, no prisma call', async (_label, qs) => {
    const app = createApp();
    const res = await getRequest(app, `/api/requirements/mine?${qs}`);
    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
  });

  it.each([
    ['foo', 'view=foo'],
    ['SUMMARY', 'view=SUMMARY'],
    ['empty string', 'view='],
    ['array-like', 'view=summary&view=detail'],
  ])('requested rejects invalid view: %s → 400, no prisma call', async (_label, qs) => {
    const app = createApp();
    const res = await getRequest(app, `/api/requirements/requested?${qs}`);
    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
//  Summary projection
// ═══════════════════════════════════════════════════════════════

describe('Summary projection', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMock(); setupAuth(DEV_USER_ID); });

  it('mine summary uses Prisma SELECT (not include)', async () => {
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args).toHaveProperty('select');
      expect(args).not.toHaveProperty('include');
      return [makeReqFields({ assigneeId: DEV_USER_ID, assignee: 'Developer' })];
    });
    mockCount.mockResolvedValue(1);
    const app = createApp();
    await getRequest(app, '/api/requirements/mine?view=summary');
  });

  it('requested summary uses Prisma SELECT (not include)', async () => {
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args).toHaveProperty('select');
      expect(args).not.toHaveProperty('include');
      return [makeReqFields({ requesterId: DEV_USER_ID })];
    });
    mockCount.mockResolvedValue(1);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?view=summary');
  });

  it('mine summary response contains exactly summary keys — no extra fields', async () => {
    // mock returns the full row (including description, workflowSnapshot, etc.)
    const fullRow = makeReqFields({ assigneeId: DEV_USER_ID, assignee: 'Developer',
      description: 'secret', workflowSnapshot: { steps: [] }, notes: 'private',
      gitHash: 'abc123', branch: 'feat/x', repoPath: '/repo', tasks: [{ id: 't1' }],
    });
    mockFindMany.mockResolvedValue([fullRow]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/mine?view=summary');
    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(Object.keys(item).sort()).toEqual(EXPECTED_SUMMARY_KEYS);
    // Double-check: large fields absent
    expect(item).not.toHaveProperty('description');
    expect(item).not.toHaveProperty('notes');
    expect(item).not.toHaveProperty('workflowSnapshot');
    expect(item).not.toHaveProperty('gitHash');
    expect(item).not.toHaveProperty('tasks');
  });

  it('requested summary response contains exactly summary keys — no extra fields', async () => {
    const fullRow = makeReqFields({ requesterId: DEV_USER_ID,
      description: 'secret', workflowSnapshot: { steps: [] }, notes: 'private',
    });
    mockFindMany.mockResolvedValue([fullRow]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested?view=summary');
    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(Object.keys(item).sort()).toEqual(EXPECTED_SUMMARY_KEYS);
    expect(item).not.toHaveProperty('description');
    expect(item).not.toHaveProperty('notes');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Requested identity & filter semantics
// ═══════════════════════════════════════════════════════════════

describe('GET /requested — identity and filters', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMock(); });

  it('developer created + assigned to PM: visible in requested', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND[0].requesterId).toBe(DEV_USER_ID);
      return [makeReqFields({ requesterId: DEV_USER_ID, assigneeId: PM_USER_ID, assignee: 'PM' })];
    });
    mockCount.mockImplementation(async (args: any) => {
      expect(args.where.AND[0].requesterId).toBe(DEV_USER_ID);
      return 1;
    });
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('other user created: not visible', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  it('developer created + assigned to self: visible once', async () => {
    setupAuth(DEV_USER_ID);
    const row = makeReqFields({ requesterId: DEV_USER_ID, assigneeId: DEV_USER_ID, assignee: 'Developer' });
    mockFindMany.mockResolvedValue([{ ...row, tasks: [], assigneeUser: null, project: null }]);
    mockCount.mockResolvedValue(1);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('admin/CTO requested: still only sees own records', async () => {
    setupAuth(OTHER_USER_ID, { role: 'admin' });
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND[0].requesterId).toBe(OTHER_USER_ID);
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('requesterId query param cannot override identity', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND[0].requesterId).toBe(DEV_USER_ID);
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?requesterId=stolen-uuid');
  });

  // Filters
  it('currentStep filter', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND).toContainEqual({ currentStep: 'qa_review' });
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?currentStep=qa_review');
  });

  it('status filter maps to currentStep', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND).toContainEqual({ currentStep: 'submitted' });
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?status=submitted');
  });

  it('priority filter', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND).toContainEqual({ priority: 'P0' });
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?priority=P0');
  });

  it('search filter', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      const searchCond = args.where.AND.find((c: any) => c.OR);
      expect(searchCond).toBeDefined();
      expect(searchCond.OR[0]).toMatchObject({ title: { contains: 'keyword', mode: 'insensitive' } });
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?search=keyword');
  });

  it('multiple filters AND with requesterId', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND.length).toBeGreaterThanOrEqual(2); // identity + 1 filter
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?priority=P1&status=draft');
  });

  it('count and findMany use identical where', async () => {
    setupAuth(DEV_USER_ID);
    let findManyWhere: any = null;
    mockFindMany.mockImplementation(async (args: any) => {
      findManyWhere = args.where;
      return [];
    });
    mockCount.mockImplementation(async (args: any) => {
      expect(args.where).toEqual(findManyWhere);
      return 0;
    });
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?priority=P0');
  });

  it('pagination and sorting', async () => {
    setupAuth(DEV_USER_ID);
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.skip).toBe(0);
      expect(args.take).toBe(5);
      expect(args.orderBy).toEqual([{ updatedAt: 'desc' }, { createdAt: 'desc' }]);
      return [];
    });
    mockCount.mockResolvedValue(0);
    const app = createApp();
    await getRequest(app, '/api/requirements/requested?page=1&pageSize=5');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Route precedence
// ═══════════════════════════════════════════════════════════════

describe('Route precedence', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMock(); setupAuth(DEV_USER_ID); });

  it('/requested matches requested handler not /:id', async () => {
    // /:id - detail handler calls findUnique. If /requested were matched as /:id,
    // findUnique would be called with { id: 'requested' }, returning null → 404.
    // But /requested should route to the list handler (findMany + count).
    mockFindMany.mockResolvedValue([makeReqFields({ requesterId: DEV_USER_ID })]);
    mockCount.mockResolvedValue(1);
    mockFindUnique.mockResolvedValue(null); // would 404 if accidentally matched

    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested');

    expect(res.status).toBe(200); // list envelope, not 404
    expect(mockFindMany).toHaveBeenCalled(); // list query ran
    expect(mockFindUnique).not.toHaveBeenCalled(); // detail query NOT ran
    expect(res.body).toHaveProperty('meta.page'); // list envelope
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Authentication
// ═══════════════════════════════════════════════════════════════

describe('Authentication', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMock(); });

  it('unauthenticated mine returns 401 from production authRequired', async () => {
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/mine', { noAuth: true });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('message');
  });

  it('unauthenticated requested returns 401', async () => {
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/requested', { noAuth: true });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
//  GET / (list) unchanged
// ═══════════════════════════════════════════════════════════════

describe('GET / (list) unchanged', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMock(); setupAuth(DEV_USER_ID); });

  it('default list behavior unchanged', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const app = createApp();
    const res = await getRequest(app, '/api/requirements/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Requested detail shape vs list detail shape
// ═══════════════════════════════════════════════════════════════

describe('Requested detail shape', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMock(); setupAuth(DEV_USER_ID); });

  it('requested detail matches list detail item shape', async () => {
    const row = makeReqFields({ requesterId: DEV_USER_ID });
    const fullRow = { ...row, tasks: [], assigneeUser: null, project: null };

    // list endpoint returns serialized requirements via serializeRequirement
    mockFindMany.mockResolvedValue([fullRow]);
    mockCount.mockResolvedValue(1);
    const app = createApp();

    const resReq = await getRequest(app, '/api/requirements/requested');
    const resList = await getRequest(app, '/api/requirements/');

    // Both must succeed
    expect(resReq.status).toBe(200);
    expect(resList.status).toBe(200);

    // Compare item shapes (same fixture, same serializer)
    const reqItem = resReq.body.data[0];
    const listItem = resList.body.data[0];
    expect(Object.keys(reqItem).sort()).toEqual(Object.keys(listItem).sort());
    expect(reqItem).toHaveProperty('description');
    expect(reqItem).toHaveProperty('tasks');
  });
});
