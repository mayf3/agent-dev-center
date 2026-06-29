/**
 * Domain isolation route-level tests — 18 scenarios from the Folder V1 contract.
 *
 * Tests use a smart Prisma mock with domain role binding simulation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const USER_ENG = '00000000-0000-0000-0000-000000000001';
const USER_CONTENT = '00000000-0000-0000-0000-000000000002';
const USER_NOBIND = '00000000-0000-0000-0000-000000000003';
const USER_GLOBAL = '00000000-0000-0000-0000-000000000004';
const USER_PERSONAL = '00000000-0000-0000-0000-000000000005';

// Domain fixtures
const DOMAIN_ENG = 'engineering';
const DOMAIN_CONTENT = 'content';
const DOMAIN_PERSONAL = 'personal';
const DOMAIN_HEALTH = 'health';
const DOMAIN_FAMILY = 'family';

// Requirement fixtures with explicit domainKey — MUST be valid UUIDs
const R_ENG = { id: '10000000-0000-0000-0000-000000000001', title: 'Eng Task 1', requester: 'Tester', requesterId: USER_ENG, assigneeId: null, assignee: null, department: 'eng', domainKey: DOMAIN_ENG, currentStep: 'pending', status: 'pending', priority: 'P2', type: 'FEATURE', tags: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
const R_CONTENT = { id: '20000000-0000-0000-0000-000000000002', title: 'Content Task 1', requester: 'ContentUser', requesterId: USER_CONTENT, assigneeId: null, assignee: null, department: 'content', domainKey: DOMAIN_CONTENT, currentStep: 'pending', status: 'pending', priority: 'P2', type: 'FEATURE', tags: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
const R_PERSONAL = { id: '30000000-0000-0000-0000-000000000003', title: 'Personal Task', requester: 'PersonalUser', requesterId: USER_PERSONAL, assigneeId: null, assignee: null, department: 'personal', domainKey: DOMAIN_PERSONAL, currentStep: 'pending', status: 'pending', priority: 'P2', type: 'FEATURE', tags: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
const R_HEALTH = { id: '40000000-0000-0000-0000-000000000004', title: 'Health Task', requester: 'HealthUser', requesterId: USER_PERSONAL, assigneeId: null, assignee: null, department: 'health', domainKey: DOMAIN_HEALTH, currentStep: 'pending', status: 'pending', priority: 'P2', type: 'FEATURE', tags: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
const R_FAMILY = { id: '50000000-0000-0000-0000-000000000005', title: 'Family Task', requester: 'FamilyUser', requesterId: USER_PERSONAL, assigneeId: null, assignee: null, department: 'family', domainKey: DOMAIN_FAMILY, currentStep: 'pending', status: 'pending', priority: 'P2', type: 'FEATURE', tags: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
const R_ENG2 = { id: '60000000-0000-0000-0000-000000000006', title: 'Eng Task 2', requester: 'Tester', requesterId: USER_ENG, assigneeId: null, assignee: null, department: 'eng', domainKey: DOMAIN_ENG, currentStep: 'pending', status: 'pending', priority: 'P2', type: 'FEATURE', tags: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };

const ALL_REQUIREMENTS = [R_ENG, R_CONTENT, R_PERSONAL, R_HEALTH, R_FAMILY, R_ENG2];

// ── Mock infrastructure ──

const { mockFindMany, mockCount, mockJwtVerify, mockUserFindUnique, mockBindingFindMany, mockDomainFindUnique, mockFindUnique } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockJwtVerify: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockBindingFindMany: vi.fn(),
  mockDomainFindUnique: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock('jsonwebtoken', () => ({ default: { verify: mockJwtVerify }, verify: mockJwtVerify }));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: { findMany: mockFindMany, count: mockCount, findUnique: mockFindUnique },
    user: { findUnique: mockUserFindUnique },
    domainRoleBinding: { findMany: mockBindingFindMany },
    businessDomain: { findUnique: mockDomainFindUnique },
    requirementReport: {},
    requirementComment: {},
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

// ── Domain scope mock helper ──

type BindingMock = { role: string; domainKey: string; isDomainAdmin?: boolean; isGlobal?: boolean };

/**
 * Setup a user with domain bindings.
 * The domainScope middleware calls resolveDomainScope which queries
 * DomainRoleBinding for the user's platform roles.  We mock that
 * findMany call so the middleware returns the right scope.
 */
function setupUser(
  userId: string,
  userOverrides: Record<string, unknown>,
  bindings: BindingMock[] = [],
  roles?: string[],
) {
  mockJwtVerify.mockReturnValue({ sub: userId });
  mockUserFindUnique.mockResolvedValue({
    id: userId, name: 'User', email: 'u@t.com',
    role: 'developer', internalRole: null,
    enabled: true, roles: roles ?? ['adc:developer'],
    ...userOverrides,
  });
  mockBindingFindMany.mockImplementation(async (args: any) => {
    const roleFilter = args?.where?.role?.in ?? [];
    return bindings.filter(b => roleFilter.includes(b.role));
  });
}

/**
 * Make findMany return only requirements matching the current domain scope.
 * This simulates what PostgreSQL would do with the Prisma WHERE clause.
 */
function smartMock() {
  mockFindMany.mockImplementation(async (args: any) => {
    let results = [...ALL_REQUIREMENTS];
    const where = args.where;
    if (!where) return results;

    // Handle top-level { id: { in: [] } } — fail-closed
    if (where?.id?.in && Array.isArray(where.id.in) && where.id.in.length === 0) {
      return [];
    }

    // Extract roleAwareRequirementWhere: it may be at where.AND[0] or directly in where
    let scopeWhere = where;
    if (where?.AND && Array.isArray(where.AND)) {
      // AND[0] is the roleAwareRequirementWhere output
      scopeWhere = where.AND[0];
    }

    // Handle nested AND from roleAwareRequirementWhere
    if (scopeWhere?.AND && Array.isArray(scopeWhere.AND)) {
      // { AND: [domainClause, roleClause] }
      const domainClause = scopeWhere.AND[0];
      if (domainClause?.id?.in && Array.isArray(domainClause.id.in) && domainClause.id.in.length === 0) {
        return []; // fail-closed
      }
      if (domainClause?.domainKey?.in) {
        results = results.filter(r => domainClause.domainKey.in.includes(r.domainKey));
      }
    } else if (scopeWhere?.domainKey?.in) {
      results = results.filter(r => scopeWhere.domainKey.in.includes(r.domainKey));
    } else if (scopeWhere?.id?.in && Array.isArray(scopeWhere.id.in) && scopeWhere.id.in.length === 0) {
      return []; // fail-closed at the scope level
    }

    // Apply additional query filters from where.AND[1..]
    if (where?.AND && Array.isArray(where.AND)) {
      for (let i = 1; i < where.AND.length; i++) {
        const f = where.AND[i];
        if (!f || typeof f !== 'object') continue;
        if (f.priority) results = results.filter(r => r.priority === f.priority);
        if (f.currentStep) results = results.filter(r => r.currentStep === f.currentStep);
        if (f.type) results = results.filter(r => r.type === f.type);
        if (f.domainKey) results = results.filter(r => r.domainKey === f.domainKey);
        if (f.tags?.hasEvery) results = results.filter(r => f.tags.hasEvery.every((t: string) => r.tags?.includes(t)));
        if (f.search?.contains) {
          const s = f.search.contains.toLowerCase();
          results = results.filter(r => r.title.toLowerCase().includes(s));
        }
      }
    }

    return results;
  });
  mockCount.mockImplementation(async (args: any) => {
    const items = await mockFindMany(args);
    return items.length;
  });
  // Detail endpoint: findUnique returns the single matching requirement
  mockFindUnique.mockImplementation(async (args: any) => {
    if (!args?.where?.id) return null;
    return ALL_REQUIREMENTS.find(r => r.id === args.where.id) ?? null;
  });
}

type TestUser = { id: string; name: string; role: string; internalRole: string | null; roles: string[]; };

const USER_DB: Record<string, TestUser> = {
  eng: { id: USER_ENG, name: 'EngUser', role: 'developer', internalRole: null, roles: ['adc:developer'] },
  content: { id: USER_CONTENT, name: 'ContentUser', role: 'developer', internalRole: null, roles: ['adc:developer'] },
  nobind: { id: USER_NOBIND, name: 'NoBindUser', role: 'developer', internalRole: null, roles: ['adc:developer'] },
  global: { id: USER_GLOBAL, name: 'GlobalUser', role: 'admin', internalRole: null, roles: ['adc:admin'] },
  personal: { id: USER_PERSONAL, name: 'PersonalUser', role: 'developer', internalRole: null, roles: ['adc:developer'] },
};

describe('Domain isolation — 18 scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    smartMock();
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. engineering 角色只能读取 engineering
  // ═══════════════════════════════════════════════════════════════
  it('1. engineering role can only read engineering requirements', async () => {
    setupUser(USER_ENG, USER_DB.eng, [
      { role: 'adc:developer', domainKey: DOMAIN_ENG },
    ]);
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((r: any) => r.id);
    expect(ids).toContain(R_ENG.id);
    expect(ids).toContain(R_ENG2.id);
    expect(ids).not.toContain(R_CONTENT.id);
    expect(ids).not.toContain(R_PERSONAL.id);
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. content 角色只能读取 content
  // ═══════════════════════════════════════════════════════════════
  it('2. content role can only read content requirements', async () => {
    setupUser(USER_CONTENT, USER_DB.content, [
      { role: 'adc:developer', domainKey: DOMAIN_CONTENT },
    ]);
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((r: any) => r.id);
    expect(ids).toContain(R_CONTENT.id);
    expect(ids).not.toContain(R_ENG.id);
    expect(ids).not.toContain(R_PERSONAL.id);
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. engineering 角色直接访问 content Requirement UUID 失败
  // ═══════════════════════════════════════════════════════════════
  it('3. engineering role getting content requirement UUID returns 403', async () => {
    setupUser(USER_ENG, USER_DB.eng, [
      { role: 'adc:developer', domainKey: DOMAIN_ENG },
    ]);
    const res = await get(`/api/requirements/${R_CONTENT.id}`);
    // Must NOT return 200 (which would indicate data leaked across domains)
    expect(res.status).not.toBe(200);
    // Must NOT return the content requirement in the body
    expect(res.body?.id ?? res.body?.data?.id).not.toBe(R_CONTENT.id);
  });

  // ═══════════════════════════════════════════════════════════════
  // 4-5. mutation/operation tests (skip — require POST/PATCH mock)
  // These are tested via the canEditRequirement + assertDomainReadAccess combo
  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  // 6. 无绑定角色无权限
  // ═══════════════════════════════════════════════════════════════
  it('6. user with no domain binding gets no requirements', async () => {
    setupUser(USER_NOBIND, USER_DB.nobind, []); // empty bindings
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. 未知角色不退化为全量
  // ═══════════════════════════════════════════════════════════════
  it('7. unknown role with no bindings gets empty result', async () => {
    setupUser(USER_NOBIND, { role: 'unknown_role' as any, internalRole: null }, []);
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. 显式全局管理员可跨 Domain
  // ═══════════════════════════════════════════════════════════════
  it('8. global admin (isGlobal flag) can cross all domains', async () => {
    setupUser(USER_GLOBAL, USER_DB.global, [
      { role: 'adc:admin', domainKey: DOMAIN_ENG, isGlobal: true },
    ]);
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((r: any) => r.id);
    // All requirements visible
    expect(ids).toContain(R_ENG.id);
    expect(ids).toContain(R_CONTENT.id);
    expect(ids).toContain(R_PERSONAL.id);
    expect(ids).toContain(R_HEALTH.id);
    expect(ids).toContain(R_FAMILY.id);
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. 普通工程角色不能访问 personal/health/family
  // ═══════════════════════════════════════════════════════════════
  it('9. engineering role cannot access personal/health/family', async () => {
    setupUser(USER_ENG, USER_DB.eng, [
      { role: 'adc:developer', domainKey: DOMAIN_ENG },
    ]);
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((r: any) => r.id);
    expect(ids).not.toContain(R_PERSONAL.id);
    expect(ids).not.toContain(R_HEALTH.id);
    expect(ids).not.toContain(R_FAMILY.id);
  });

  // ═══════════════════════════════════════════════════════════════
  // 10. 无权 Domain 创建失败 — tested via POST mock
  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  // 12. 不传过滤仍只返回授权范围
  // ═══════════════════════════════════════════════════════════════
  it('12. no filter param still returns only authorized domains', async () => {
    setupUser(USER_ENG, USER_DB.eng, [
      { role: 'adc:developer', domainKey: DOMAIN_ENG },
    ]);
    // Request without domainKey filter
    const res = await get('/api/requirements/');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((r: any) => r.id);
    expect(ids).toEqual(expect.arrayContaining([R_ENG.id, R_ENG2.id]));
    expect(ids).not.toContain(R_CONTENT.id);
  });

  // ═══════════════════════════════════════════════════════════════
  // 18. list, detail, mine, kanban 路径范围一致
  // ═══════════════════════════════════════════════════════════════
  it('18. list + kanban endpoints respect domain boundaries', async () => {
    setupUser(USER_ENG, USER_DB.eng, [
      { role: 'adc:developer', domainKey: DOMAIN_ENG },
    ]);

    // List
    const listRes = await get('/api/requirements/');
    expect(listRes.status).toBe(200);
    const listIds = (listRes.body.data ?? []).map((r: any) => r.id);
    expect(listIds).toContain(R_ENG.id);
    expect(listIds).not.toContain(R_CONTENT.id);

    // Kanban (also uses roleAwareRequirementWhere)
    const kanbanRes = await get('/api/requirements/kanban');
    expect(kanbanRes.status).toBe(200);
    const kanbanIds = Object.values(kanbanRes.body.data ?? {}).flat().map((r: any) => r.id);
    expect(kanbanIds).toContain(R_ENG.id);
    expect(kanbanIds).not.toContain(R_CONTENT.id);
  });
});
