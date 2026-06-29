/**
 * Route-level tests for roleAwareRequirementWhere — fail-closed behavior.
 *
 * Uses a smart Prisma mock that evaluates the WHERE clause to determine which
 * of R1/R2/R3 would be returned.  Tests prove Base vs Feature differ in the
 * corrupted-role case, while legal-role cases pass on both sides.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const USER_ID = '00000000-0000-0000-0000-000000000001';

// ── Test database: three artificially distinguishable rows ──

const R1 = { id: 'r1-00000000-1111-1111-1111-111111111111', requesterId: USER_ID, requester: 'Tester', assigneeId: 'other-00000000-0000-0000-0000-000000000099', assignee: 'Other' };
const R2 = { id: 'r2-00000000-2222-2222-2222-222222222222', requesterId: 'other-11111111-0000-0000-0000-111111111111', requester: 'Alice', assigneeId: USER_ID, assignee: 'Tester' };
const R3 = { id: 'r3-00000000-3333-3333-3333-333333333333', requesterId: 'other-22222222-0000-0000-0000-222222222222', requester: 'Bob', assigneeId: 'other-33333333-0000-0000-0000-333333333333', assignee: 'Charlie' };
const ALL = [R1, R2, R3];

/**
 * Interpret a Prisma RequirementWhereInput and return the matching fixtures.
 * Simulates what real PostgreSQL would produce.
 */
function filterFixtures(where: any): typeof ALL {
  // Extract the role-scope condition from the AND array
  let roleCondition: any;
  if (where?.AND && Array.isArray(where.AND)) {
    roleCondition = where.AND[0];
  } else {
    // should not happen with core-list.ts, but be safe
    roleCondition = where ?? {};
  }

  // Empty condition → all visible
  if (roleCondition === undefined || roleCondition === null || (typeof roleCondition === 'object' && Object.keys(roleCondition).length === 0)) {
    return ALL;
  }

  // { id: { in: [] } } → none (Feature fail-closed)
  if (roleCondition?.id?.in && Array.isArray(roleCondition.id.in) && roleCondition.id.in.length === 0) {
    return [];
  }

  // { OR: [...] } — check which fields are referenced
  const orClause = roleCondition?.OR;
  if (orClause && Array.isArray(orClause)) {
    const hasAssigneeFilter = orClause.some((c: any) => c.assigneeId !== undefined);
    const hasRequesterFilter = orClause.some((c: any) => c.requesterId !== undefined);

    if (hasAssigneeFilter && !hasRequesterFilter) {
      // ASSIGNEE scope — only R2
      return ALL.filter(r => r.assigneeId === USER_ID || r.assignee === 'Tester');
    }
    if (hasRequesterFilter && !hasAssigneeFilter) {
      // REQUESTER scope — only R1
      return ALL.filter(r => r.requesterId === USER_ID || r.requester === 'Tester');
    }
    // Both (shouldn't happen) — include both
    return ALL.filter(r => r.assigneeId === USER_ID || r.requesterId === USER_ID);
  }

  // Unknown structure — safest: return nothing
  return [];
}

// ── Mocks ──

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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/requirements', requirementsRouter);
  app.use(errorHandler);
  return app;
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const app = createApp();
  const server = app.listen(0); await new Promise<void>(r => server.on('listening', r));
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET', headers: { Authorization: 'Bearer t' } }, (res) => {
      let d = ''; res.on('data', (c: string) => d += c);
      res.on('end', () => { server.close(); let b: any; try { b = JSON.parse(d); } catch { b = d; } resolve({ status: res.statusCode ?? 500, body: b }); });
    });
    req.on('error', reject); req.end();
  });
}

function setupJwt(userId: string = USER_ID) { mockJwtVerify.mockReturnValue({ sub: userId }); }

function setupUser(overrides: Record<string, unknown> = {}) {
  mockUserFindUnique.mockResolvedValue({ id: USER_ID, name: 'Tester', email: 't@t.com', role: 'developer', internalRole: 'backend_developer', enabled: true, ...overrides });
}

/**
 * Make domain scope return cross-domain access so legacy role tests
 * are not affected by domain isolation.
 * Sets both the user's roles array (so getPlatformRoles returns it)
 * and the domain role binding mock (so the middleware finds the binding).
 */
function setupGlobalDomain(user: Record<string, unknown>) {
  const role = user.role ?? 'developer';
  const internalRole = user.internalRole;
  let platformRole = 'adc:developer';
  if (role === 'admin' || internalRole === 'cto') {
    platformRole = 'adc:admin';
  } else if (role === 'cto_agent') {
    platformRole = 'adc:admin';
  } else if (role === 'agent' || role === 'requester') {
    platformRole = 'adc:viewer';
  } else if (internalRole === 'qa' || internalRole === 'tester' || internalRole === 'security' || internalRole === 'ops') {
    platformRole = `adc:${internalRole}`;
  }
  // Set the user's roles so getPlatformRoles returns the correct value
  mockUserFindUnique.mockResolvedValue({
    id: USER_ID, name: 'Tester', email: 't@t.com',
    role: 'developer', internalRole: 'backend_developer',
    roles: [platformRole],
    enabled: true,
    ...user,
  });
  // Make the binding always return a global binding for the platform role
  mockBindingFindMany.mockResolvedValue([
    { role: platformRole, domainKey: 'engineering', isDomainAdmin: false, isGlobal: true },
  ]);
}

function smartMock() {
  mockFindMany.mockImplementation(async (args: any) => filterFixtures(args.where));
  mockCount.mockImplementation(async (args: any) => filterFixtures(args.where).length);
}

describe('roleAwareRequirementWhere — R1/R2/R3 evidence', () => {
  beforeEach(() => { vi.clearAllMocks(); smartMock(); });

  // ── Helper to run one test scenario ──
  async function check(desc: string, user: Record<string, unknown>, expectR1: boolean, expectR2: boolean, expectR3: boolean) {
    setupJwt(USER_ID);
    setupUser(user);
    setupGlobalDomain(user);
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((r: any) => r.id);
    const r1Seen = ids.includes(R1.id);
    const r2Seen = ids.includes(R2.id);
    const r3Seen = ids.includes(R3.id);

    console.log(`[${desc}] got=[${ids.join(',')}] expect=(${expectR1?'R1':'-'},${expectR2?'R2':'-'},${expectR3?'R3':'-'})`);

    expect(r1Seen).toBe(expectR1);
    expect(r2Seen).toBe(expectR2);
    expect(r3Seen).toBe(expectR3);
    return res;
  }

  // ═══════════════════════════════════════════════════════════════
  //  1-6: role + internalRole 矩阵
  // ═══════════════════════════════════════════════════════════════

  it('1. admin + null → ALL (R1,R2,R3)', async () => {
    await check('admin+null', { role: 'admin', internalRole: null }, true, true, true);
  });

  it('2. admin + architect → ALL', async () => {
    await check('admin+architect', { role: 'admin', internalRole: 'architect' }, true, true, true);
  });

  it('3. cto_agent + unknown → ALL', async () => {
    await check('cto_agent+unknown', { role: 'cto_agent', internalRole: 'some_new_role' }, true, true, true);
  });

  it('4. agent + cto → ALL', async () => {
    await check('agent+cto', { role: 'agent', internalRole: 'cto' }, true, true, true);
  });

  it('5. agent + qa → ALL', async () => {
    await check('agent+qa', { role: 'agent', internalRole: 'qa' }, true, true, true);
  });

  it('6. agent + backend_developer → ASSIGNEE (R2)', async () => {
    await check('agent+backend_developer', { role: 'agent', internalRole: 'backend_developer' }, false, true, false);
  });

  it('7. agent + architect → REQUESTER (R1)', async () => {
    await check('agent+architect', { role: 'agent', internalRole: 'architect' }, true, false, false);
  });

  it('8. agent + null → REQUESTER (R1)', async () => {
    await check('agent+null', { role: 'agent', internalRole: null }, true, false, false);
  });

  it('9. requester + architect → REQUESTER (R1)', async () => {
    await check('requester+architect', { role: 'requester', internalRole: 'architect' }, true, false, false);
  });

  it('10. requester + null → REQUESTER (R1)', async () => {
    await check('requester+null', { role: 'requester', internalRole: null }, true, false, false);
  });

  it('11. developer + architect → ASSIGNEE (R2)', async () => {
    await check('developer+architect', { role: 'developer', internalRole: 'architect' }, false, true, false);
  });

  it('12. developer + null → ASSIGNEE (R2)', async () => {
    await check('developer+null', { role: 'developer', internalRole: null }, false, true, false);
  });

  it('13. corrupted role + corrupted internalRole → EMPTY (no R1,R2,R3)', async () => {
    // This is the KEY distinguisher test:
    //   On BASE (old fallback): R1 visible (requester scope)
    //   On FEATURE: no results (fail-closed)
    await check('corrupted+corrupted', { role: 'corrupted_role' as any, internalRole: 'corrupted_internal' }, false, false, false);
  });

  // ═══════════════════════════════════════════════════════════════
  //  14-16: query parameters cannot bypass fail-closed
  // ═══════════════════════════════════════════════════════════════

  it('14. corrupted + search → still EMPTY', async () => {
    setupJwt(USER_ID);
    setupUser({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    setupGlobalDomain({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    const res = await get('/api/requirements/?search=keyword');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  it('15. corrupted + priority filter → still EMPTY', async () => {
    setupJwt(USER_ID);
    setupUser({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    setupGlobalDomain({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    const res = await get('/api/requirements/?priority=P0');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('16. count and findMany use same where for corrupted', async () => {
    setupJwt(USER_ID);
    setupUser({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    setupGlobalDomain({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    let findManyWhere: any = null;
    mockFindMany.mockImplementation(async (args: any) => { findManyWhere = args.where; return []; });
    mockCount.mockImplementation(async (args: any) => { expect(args.where).toEqual(findManyWhere); return 0; });
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
  });

  // ═══════════════════════════════════════════════════════════════
  //  17-18: /mine and /requested unaffected
  // ═══════════════════════════════════════════════════════════════

  it('17. /mine still filters by assigneeId for corrupted', async () => {
    setupJwt(USER_ID);
    setupUser({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    setupGlobalDomain({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.assigneeId).toBe(USER_ID);
      return [];
    });
    mockCount.mockResolvedValue(0);
    const res = await get('/api/requirements/mine');
    expect(res.status).toBe(200);
  });

  it('18. /requested still filters by requesterId for corrupted', async () => {
    setupJwt(USER_ID);
    setupUser({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    setupGlobalDomain({ role: 'corrupted_role' as any, internalRole: 'corrupted_internal' });
    mockFindMany.mockImplementation(async (args: any) => {
      expect(args.where.AND[0].requesterId).toBe(USER_ID);
      return [];
    });
    mockCount.mockResolvedValue(0);
    const res = await get('/api/requirements/requested');
    expect(res.status).toBe(200);
  });
});
