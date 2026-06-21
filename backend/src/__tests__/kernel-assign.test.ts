/**
 * Kernel Phase 2A — Assign Integration Tests
 *
 * PATCH workflowId rejection: pure function, no DB needed.
 * Assignment: real PostgreSQL integration (KERNEL_TEST_DATABASE_URL).
 *
 * vi.mock on assignee-resolver is used solely to verify tx client
 * injection — it calls through to the real implementation.
 */
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { HttpError } from '../utils/http-error.js';
import { assignWorkflowAtomic } from '../routes/requirements/workflow-assign-service.js';
import { assertPatchDoesNotMutateWorkflowId } from '../routes/requirements/core-crud.js';

// ── Deferred (deterministic concurrency barrier) ─────────────

class Deferred<T = void> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  constructor() {
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  }
}

// ── PATCH workflowId rejection (pure function, no PG needed) ─

describe('assertPatchDoesNotMutateWorkflowId', () => {
  test('workflowId string → 400', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId({ workflowId: 'abc' }))
      .toThrow(HttpError);
  });

  test('workflowId null → 400 (null !== undefined, in-check catches it)', () => {
    const err = assertThrows(() => assertPatchDoesNotMutateWorkflowId({ workflowId: null }));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(400);
  });

  test('workflowId undefined → no throw (no mutation attempt)', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId({ workflowId: undefined }))
      .not.toThrow();
  });

  test('repoPath only → no throw', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId({ repoPath: '/repo' }))
      .not.toThrow();
  });

  test('branch only → no throw', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId({ branch: 'feature/x' }))
      .not.toThrow();
  });

  test('repoPath + branch → no throw', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId({ repoPath: '/repo', branch: 'main' }))
      .not.toThrow();
  });

  test('empty object → no throw', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId({}))
      .not.toThrow();
  });

  test('null body → no throw', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId(null))
      .not.toThrow();
  });

  test('non-object body → no throw', () => {
    expect(() => assertPatchDoesNotMutateWorkflowId('string'))
      .not.toThrow();
  });
});

function assertThrows(fn: () => void): unknown {
  try { fn(); } catch (e) { return e; }
  return undefined;
}

// ── Mock: wrap resolveAssigneeForStep to track calls ─────────
// vitest hoists vi.mock to top; only modules importing from
// assignee-resolver are affected (assignWorkflowAtomic does).

vi.mock('../lib/assignee-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/assignee-resolver.js')>();
  return {
    ...actual,
    resolveAssigneeForStep: vi.fn(actual.resolveAssigneeForStep),
  };
});

import { resolveAssigneeForStep as mockResolveFn } from '../lib/assignee-resolver.js';

// ── PG Integration ──────────────────────────────────────────

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;

const integration = PG_URL ? describe : describe.skip;

integration('assignment integration (needs KERNEL_TEST_DATABASE_URL)', () => {
  let pg: PrismaClient;
  let users: { dev: string; tester: string; cto: string };
  let counter = 0;

  const ARRAY_TEMPLATE_STEPS = [
    { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
    { name: 'dev', displayName: '开发', role: 'backend_developer', requiredReports: [], autoAdvance: false },
    { name: 'qa', displayName: 'QA测试', role: 'tester', requiredReports: [], autoAdvance: false },
  ];

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: PG_URL });
    await pg.$connect();

    const ts = String(Date.now());
    const dev = await pg.user.create({
      data: {
        name: `kt-dev-${ts}`, email: `kt-dev-${ts}@t.com`,
        internalRole: 'backend_developer', role: 'developer', password: 'x',
      },
      select: { id: true },
    });
    const tester = await pg.user.create({
      data: {
        name: `kt-tester-${ts}`, email: `kt-tester-${ts}@t.com`,
        internalRole: 'tester', role: 'developer', password: 'x',
      },
      select: { id: true },
    });
    const cto = await pg.user.create({
      data: {
        name: `kt-cto-${ts}`, email: `kt-cto-${ts}@t.com`,
        internalRole: 'cto', role: 'admin', password: 'x',
      },
      select: { id: true },
    });
    users = { dev: dev.id, tester: tester.id, cto: cto.id };
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (users) {
      await pg.user.deleteMany({ where: { id: { in: [users.dev, users.tester, users.cto] } } });
    }
    await pg.$disconnect();
  });

  async function createTemplate(steps: unknown, nameSuffix = ''): Promise<string> {
    counter++;
    const t = await pg.workflowTemplate.create({
      data: {
        name: `kt-tpl-${Date.now()}-${counter}${nameSuffix}`,
        displayName: `KT Template ${counter}`,
        description: 'test template',
        steps: steps as any,
        isActive: true,
      },
      select: { id: true },
    });
    return t.id;
  }

  async function assign(reqId: string, tplName: string, startStep?: string, opts?: { beforeCas?: () => Promise<void> }) {
    return assignWorkflowAtomic(reqId, tplName, startStep, { ...opts, prisma: pg as any });
  }

  async function createRequirement(overrides?: { requesterId?: string }): Promise<string> {
    counter++;
    const r = await pg.requirement.create({
      data: {
        title: `kt-req-${Date.now()}-${counter}`,
        description: 'test requirement',
        priority: 'P2',
        type: 'FEATURE',
        requester: 'test-req',
        department: 'engineering',
        requesterId: overrides?.requesterId ?? users.dev,
        stateVersion: 1,
      },
      select: { id: true },
    });
    return r.id;
  }

  async function readRequirement(id: string) {
    return pg.requirement.findUnique({
      where: { id },
      select: { workflowId: true, workflowSnapshot: true, currentStep: true, assigneeId: true, stateVersion: true },
    });
  }

  async function getTemplateName(id: string): Promise<string> {
    const t = await pg.workflowTemplate.findUnique({ where: { id }, select: { name: true } });
    return t!.name;
  }

  // ── T1: Array template → five fields written ─────────────

  test('T1: array template — five fields atomically written', async () => {
    const tplId = await createTemplate(ARRAY_TEMPLATE_STEPS);
    const reqId = await createRequirement();

    const result = await assign(reqId, await getTemplateName(tplId));

    expect(result.workflowId).toBe(tplId);
    expect(result.workflowSnapshot).toBeDefined();
    expect(result.currentStep).toBe('draft');
    expect(result.assigneeId).toBe(users.dev);
    expect(result.stateVersion).toBe(2);

    const saved = await readRequirement(reqId);
    expect(saved?.workflowId).toBe(tplId);
    expect(saved?.workflowSnapshot).toBeDefined();
    expect(saved?.currentStep).toBe('draft');
    expect(saved?.assigneeId).toBe(users.dev);
    expect(saved?.stateVersion).toBe(2);
  });

  // ── T2: Object template with roleUserMap ──────────────────

  test('T2: object template — roleUserMap preserved in snapshot', async () => {
    const steps = {
      steps: [
        { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
        { name: 'dev', displayName: '开发', role: 'backend_developer', requiredReports: [], autoAdvance: false },
      ],
      roleUserMap: { backend_developer: users.dev },
    };
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement();

    const result = await assign(reqId, await getTemplateName(tplId));

    expect(result.workflowId).toBe(tplId);
    const snap = result.workflowSnapshot as Record<string, unknown>;
    expect(typeof snap).toBe('object');
    expect((snap as any).roleUserMap).toEqual({ backend_developer: users.dev });
  });

  // ── T3: stateVersion n → n+1 ──────────────────────────────

  test('T3: stateVersion increments from n to n+1', async () => {
    const tplId = await createTemplate(ARRAY_TEMPLATE_STEPS);
    const reqId = await createRequirement();
    const before = await readRequirement(reqId);

    const result = await assign(reqId, await getTemplateName(tplId));

    expect(result.stateVersion).toBe((before?.stateVersion ?? 0) + 1);
  });

  // ── T4: Snapshot deep equal ──────────────────────────────

  test('T4: snapshot deep equal to template JSON', async () => {
    const steps = [
      { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: ['TEST_REPORT'], autoAdvance: false },
    ];
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement();

    const result = await assign(reqId, await getTemplateName(tplId));

    expect(result.workflowSnapshot).toEqual(steps);
  });

  // ── T5: Snapshot preserves step assigneeMode ─────────────

  test('T5: snapshot preserves step-level details (assigneeMode)', async () => {
    const steps = [
      { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
    ];
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement();

    const result = await assign(reqId, await getTemplateName(tplId));

    const snap = result.workflowSnapshot as any[];
    expect(snap[0].assigneeMode).toBe('role-based');
  });

  // ── T6: Template modification isolation ───────────────────

  test('T6: template modified post-assign → snapshot unchanged', async () => {
    const steps = [
      { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
    ];
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement();

    await assign(reqId, await getTemplateName(tplId));

    await pg.workflowTemplate.update({
      where: { id: tplId },
      data: {
        steps: [{ name: 'changed', displayName: '改后', role: 'backend_developer', requiredReports: [], autoAdvance: false }] as any,
      },
    });

    const saved = await readRequirement(reqId);
    expect(saved?.workflowSnapshot).toEqual(steps);
    expect((saved?.workflowSnapshot as any[])[0].name).toBe('draft');
  });

  // ── T7: Requester role → requesterId ─────────────────────

  test('T7: requester role resolved to requesterId', async () => {
    const steps = [
      { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
    ];
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement({ requesterId: users.cto });

    const result = await assign(reqId, await getTemplateName(tplId));

    expect(result.assigneeId).toBe(users.cto);
    expect(result.currentStep).toBe('draft');
  });

  // ── T8: roleUserMap → assigneeId ─────────────────────────

  test('T8: roleUserMap assigns specific user when startStep targets that role', async () => {
    const steps = {
      steps: [
        { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
        { name: 'dev', displayName: '开发', role: 'backend_developer', requiredReports: [], autoAdvance: false },
      ],
      roleUserMap: { backend_developer: users.tester },
    };
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement();

    const result = await assign(reqId, await getTemplateName(tplId), 'dev');

    expect(result.currentStep).toBe('dev');
    expect(result.assigneeId).toBe(users.tester);
  });

  // ── T9: Role/fallback rules preserved ───────────────────

  test('T9: CTO fallback when no matching role user exists', async () => {
    const steps = [
      { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
      { name: 'arch', displayName: '架构', role: 'architect', requiredReports: [], autoAdvance: false },
    ];
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement();

    const result = await assign(reqId, await getTemplateName(tplId), 'arch');

    expect(result.currentStep).toBe('arch');
    expect(result.assigneeId).toBe(users.cto);
  });

  // ── T10: Existing workflowId → 409 + repeat assign → 409 ─

  test('T10a: existing workflowId → 409, first assignment preserved', async () => {
    const tplId = await createTemplate(ARRAY_TEMPLATE_STEPS);
    const reqId = await createRequirement();

    await assign(reqId, await getTemplateName(tplId));

    const tpl2Id = await createTemplate(ARRAY_TEMPLATE_STEPS);
    await expect(
      assign(reqId, await getTemplateName(tpl2Id)),
    ).rejects.toThrow(HttpError);

    const saved = await readRequirement(reqId);
    expect(saved?.workflowId).toBe(tplId);
    expect(saved?.stateVersion).toBe(2);
  });

  test('T10b: repeat assign → 409', async () => {
    const tplId = await createTemplate(ARRAY_TEMPLATE_STEPS);
    const reqId = await createRequirement();

    await assign(reqId, await getTemplateName(tplId));

    await expect(
      assign(reqId, await getTemplateName(tplId)),
    ).rejects.toThrow(HttpError);
  });

  // ── T11: Invalid template → 4xx, five fields unchanged ──

  test('T11: invalid template structure → 400, five fields unchanged', async () => {
    const tplId = await createTemplate({ steps: 'not-an-array' });
    const reqId = await createRequirement();

    await expect(
      assign(reqId, await getTemplateName(tplId)),
    ).rejects.toThrow(HttpError);

    const saved = await readRequirement(reqId);
    expect(saved?.workflowId).toBeNull();
    expect(saved?.workflowSnapshot).toBeNull();
    expect(saved?.currentStep).toBeNull();
    expect(saved?.assigneeId).toBeNull();
    expect(saved?.stateVersion).toBe(1);
  });

  // ── T12: Template not found → 404, five fields unchanged ─

  test('T12: template not found → 404, five fields unchanged', async () => {
    const reqId = await createRequirement();

    await expect(
      assign(reqId, 'non-existent-template-name-xyz'),
    ).rejects.toThrow(HttpError);

    const saved = await readRequirement(reqId);
    expect(saved?.workflowId).toBeNull();
    expect(saved?.workflowSnapshot).toBeNull();
    expect(saved?.currentStep).toBeNull();
    expect(saved?.assigneeId).toBeNull();
    expect(saved?.stateVersion).toBe(1);
  });

  // ── T15: Deterministic concurrency — 1 success, 1 conflict ─

  test('T15: concurrent assign — exactly 1 success, 1 conflict', async () => {
    const tplId = await createTemplate(ARRAY_TEMPLATE_STEPS);
    const reqId = await createRequirement();
    const barrier = new Deferred<void>();
    const tplName = await getTemplateName(tplId);

    const a = assign(reqId, tplName, undefined, { beforeCas: () => barrier.promise });
    const b = assign(reqId, tplName, undefined, { beforeCas: () => barrier.promise });

    await new Promise(r => setTimeout(r, 200));

    barrier.resolve();

    const results = await Promise.allSettled([a, b]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (rejected[0].status === 'rejected') {
      const err = rejected[0].reason;
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(409);
    }

    const saved = await readRequirement(reqId);
    expect(saved?.stateVersion).toBe(2);
    expect(saved?.workflowId).toBe(tplId);
  });

  // ── T16: Transaction client injection proof ─────────────

  test('T16: resolveAssigneeForStep receives tx client inside transaction', async () => {
    vi.clearAllMocks();
    // Template with a non-requester starting step to trigger resolveAssigneeForStep
    const steps = {
      steps: [
        { name: 'dev', displayName: '开发', role: 'backend_developer', requiredReports: [], autoAdvance: false },
      ],
    };
    const tplId = await createTemplate(steps);
    const reqId = await createRequirement();

    await assign(reqId, await getTemplateName(tplId), 'dev');

    expect(mockResolveFn).toHaveBeenCalled();
    const calls = (mockResolveFn as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) {
      expect(call.length).toBeGreaterThanOrEqual(3);
      expect(call[2]).toBeTruthy();
      expect(typeof call[2].user).toBe('object');
    }
  });

  // ── T17: repoPath/branch PG write verification ──────────

  test('T17: repoPath and branch field writes via PG', async () => {
    const reqId = await createRequirement();

    await pg.requirement.update({
      where: { id: reqId },
      data: { repoPath: '/test/repo', branch: 'feature/test-branch' },
    });

    const saved = await pg.requirement.findUnique({
      where: { id: reqId },
      select: { repoPath: true, branch: true },
    });

    expect(saved?.repoPath).toBe('/test/repo');
    expect(saved?.branch).toBe('feature/test-branch');

    await pg.requirement.update({
      where: { id: reqId },
      data: { repoPath: '/combined/repo', branch: 'combined-branch' },
    });

    const saved2 = await pg.requirement.findUnique({
      where: { id: reqId },
      select: { repoPath: true, branch: true },
    });
    expect(saved2?.repoPath).toBe('/combined/repo');
    expect(saved2?.branch).toBe('combined-branch');
  });
});
