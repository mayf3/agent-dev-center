/**
 * Unit tests for workflow-helpers.ts
 *
 * Covers:
 *  - checkReportsApproved: self-certify (pending ok) vs need-approval (approved required)
 *  - parseSteps: valid and invalid step definitions
 *  - getNextStep / getPreviousStep: navigation
 *  - mapUserRole: role mapping
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock prisma — factory must not reference outer variables (hoisted) ──
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirementReport: { findMany: vi.fn() },
    requirement: { count: vi.fn() },
    workflowTransition: { create: vi.fn() },
  },
}));

import {
  parseSteps,
  getCurrentStep,
  getNextStep,
  getPreviousStep,
  mapUserRole,
  checkReportsApproved,
  getWorkflowSteps,
  getWorkflowRawJson,
  extractRoleUserMap,
} from '../routes/requirements/workflow-helpers.js';

import { prisma } from '../lib/prisma.js';

const mockFindMany = prisma.requirementReport.findMany as ReturnType<typeof vi.fn>;

// ── Sample steps ─────────────────────────────────────────

const sampleSteps = [
  { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [] as string[], autoAdvance: false },
  { name: 'dev_self_check', displayName: '开发自检', role: 'developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
  { name: 'testing', displayName: '测试', role: 'tester', requiredReports: ['TEST_REPORT'], autoAdvance: false },
  { name: 'cto_review', displayName: 'CTO验收', role: 'cto', requiredReports: ['CTO_REVIEW'], autoAdvance: false },
  { name: 'deploying', displayName: '部署', role: 'ops', requiredReports: ['DEPLOY_CONFIRM'], autoAdvance: false },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [] as string[], autoAdvance: false },
];

// ── Tests ────────────────────────────────────────────────

describe('parseSteps', () => {
  it('parses valid step definitions', () => {
    const result = parseSteps(sampleSteps);
    expect(result).toHaveLength(6);
    expect(result[0].name).toBe('draft');
  });

  it('rejects steps missing required fields', () => {
    expect(() => parseSteps([{ name: 'x' }])).toThrow();
  });

  it('defaults autoAdvance to false when omitted', () => {
    const steps = [{ name: 's', displayName: 'S', role: 'dev', requiredReports: [] }];
    const result = parseSteps(steps as any);
    expect(result[0].autoAdvance).toBe(false);
  });
});

describe('getCurrentStep', () => {
  it('finds existing step', () => {
    expect(getCurrentStep(sampleSteps, 'testing')?.displayName).toBe('测试');
  });

  it('returns undefined for non-existent step', () => {
    expect(getCurrentStep(sampleSteps, 'nonexistent')).toBeUndefined();
  });
});

describe('getNextStep / getPreviousStep', () => {
  it('getNextStep returns next step', () => {
    expect(getNextStep(sampleSteps, 'draft')?.name).toBe('dev_self_check');
  });

  it('getNextStep returns null at end', () => {
    expect(getNextStep(sampleSteps, 'done')).toBeNull();
  });

  it('getPreviousStep returns previous step', () => {
    expect(getPreviousStep(sampleSteps, 'cto_review')?.name).toBe('testing');
  });

  it('getPreviousStep returns null at start', () => {
    expect(getPreviousStep(sampleSteps, 'draft')).toBeNull();
  });
});

describe('mapUserRole', () => {
  it('maps cto to cto role', () => {
    expect(mapUserRole('cto', 'cto')).toBe('cto');
  });

  it('maps cto to admin role', () => {
    expect(mapUserRole('cto', 'admin')).toBe('admin');
  });

  it('rejects mismatched roles', () => {
    expect(mapUserRole('frontend_developer', 'cto')).toBeNull();
  });

  it('returns null for null internalRole', () => {
    expect(mapUserRole(null, 'cto')).toBeNull();
  });

  it('maps pm to requester role', () => {
    expect(mapUserRole('pm', 'requester')).toBe('requester');
  });
});

describe('checkReportsApproved', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('returns ok=true when no reports required', async () => {
    const result = await checkReportsApproved('req-1', []);
    expect(result).toEqual({ ok: true, missing: [] });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  // ── Self-certify types: DEV_SELF_CHECK, DEPLOY_CONFIRM ──

  it('DEV_SELF_CHECK: pending status is sufficient (self-certify)', async () => {
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'DEV_SELF_CHECK' },
    ]);

    const result = await checkReportsApproved('req-1', ['DEV_SELF_CHECK']);
    expect(result).toEqual({ ok: true, missing: [] });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['pending', 'approved'] },
        }),
      }),
    );
  });

  it('DEV_SELF_CHECK: missing report returns missing', async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await checkReportsApproved('req-1', ['DEV_SELF_CHECK']);
    expect(result).toEqual({ ok: false, missing: ['DEV_SELF_CHECK'] });
  });

  it('DEPLOY_CONFIRM: pending status is sufficient (self-certify)', async () => {
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'DEPLOY_CONFIRM' },
    ]);

    const result = await checkReportsApproved('req-1', ['DEPLOY_CONFIRM']);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  // ── Non-self-certify types ──

  it('TEST_REPORT: pending status is NOT sufficient (needs approval)', async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await checkReportsApproved('req-1', ['TEST_REPORT']);
    expect(result).toEqual({ ok: false, missing: ['TEST_REPORT'] });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'approved',
        }),
      }),
    );
  });

  it('TEST_REPORT: approved status passes', async () => {
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'TEST_REPORT' },
    ]);

    const result = await checkReportsApproved('req-1', ['TEST_REPORT']);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('CTO_REVIEW: approved status passes', async () => {
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'CTO_REVIEW' },
    ]);

    const result = await checkReportsApproved('req-1', ['CTO_REVIEW']);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('SECURITY_REVIEW: approved status passes', async () => {
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'SECURITY_REVIEW' },
    ]);

    const result = await checkReportsApproved('req-1', ['SECURITY_REVIEW']);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  // ── Mixed ──

  it('mixed: DEV_SELF_CHECK pending + TEST_REPORT approved → ok', async () => {
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'DEV_SELF_CHECK' },
    ]);
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'TEST_REPORT' },
    ]);

    const result = await checkReportsApproved('req-1', ['DEV_SELF_CHECK', 'TEST_REPORT']);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('mixed: DEV_SELF_CHECK pending + TEST_REPORT NOT approved → missing TEST_REPORT', async () => {
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'DEV_SELF_CHECK' },
    ]);
    mockFindMany.mockResolvedValueOnce([]);

    const result = await checkReportsApproved('req-1', ['DEV_SELF_CHECK', 'TEST_REPORT']);
    expect(result).toEqual({ ok: false, missing: ['TEST_REPORT'] });
  });

  it('mixed: DEV_SELF_CHECK missing + TEST_REPORT approved → missing DEV_SELF_CHECK', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([
      { reportType: 'TEST_REPORT' },
    ]);

    const result = await checkReportsApproved('req-1', ['DEV_SELF_CHECK', 'TEST_REPORT']);
    expect(result).toEqual({ ok: false, missing: ['DEV_SELF_CHECK'] });
  });

  it('all missing: returns all in missing list', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);

    const result = await checkReportsApproved('req-1', ['DEV_SELF_CHECK', 'TEST_REPORT', 'CTO_REVIEW']);
    expect(result).toEqual({ ok: false, missing: ['DEV_SELF_CHECK', 'CTO_REVIEW', 'TEST_REPORT'] });
  });
});

// ── Workflow Snapshot tests ──────────────────────────────

describe('getWorkflowRawJson', () => {
  const originalSteps = [
    { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [] as string[], autoAdvance: false },
    { name: 'dev_self_check', displayName: '开发自检', role: 'developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
    { name: 'done', displayName: '完成', role: 'cto', requiredReports: [] as string[], autoAdvance: false },
  ];

  it('returns null for null input', () => {
    expect(getWorkflowRawJson(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(getWorkflowRawJson(undefined)).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(getWorkflowRawJson({})).toBeNull();
  });

  it('returns workflowSnapshot when present', () => {
    const result = getWorkflowRawJson({
      workflowSnapshot: originalSteps,
      workflow: { steps: [] },
    });
    expect(result).toBe(originalSteps);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns null workflowSnapshot when explicitly null (legacy), falls through', () => {
    const result = getWorkflowRawJson({
      workflowSnapshot: null,
      workflow: { steps: [{ name: 'legacy', displayName: '旧版', role: 'dev', requiredReports: [], autoAdvance: false }] },
    });
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[])[0].name).toBe('legacy');
  });

  it('falls back to workflow.steps when workflowSnapshot is absent', () => {
    const result = getWorkflowRawJson({
      workflow: { steps: originalSteps },
    });
    expect(result).toBe(originalSteps);
  });

  it('uses workflowSnapshot over workflow.steps (priority test)', () => {
    const snapshot = [{ name: 'snapshot_step', displayName: '快照版', role: 'dev', requiredReports: [] as string[], autoAdvance: false }];
    const template = [{ name: 'template_step', displayName: '新版', role: 'cto', requiredReports: [] as string[], autoAdvance: false }];
    const result = getWorkflowRawJson({
      workflowSnapshot: snapshot,
      workflow: { steps: template },
    });
    expect(result).toBe(snapshot);
    expect((result as any[])[0].name).toBe('snapshot_step');
  });
});

describe('getWorkflowSteps', () => {
  const originalSteps = [
    { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [] as string[], autoAdvance: false },
    { name: 'dev_self_check', displayName: '开发自检', role: 'developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
    { name: 'done', displayName: '完成', role: 'cto', requiredReports: [] as string[], autoAdvance: false },
  ];

  it('returns empty array for null input', () => {
    expect(getWorkflowSteps(null)).toEqual([]);
  });

  it('returns empty array for input with no workflow', () => {
    expect(getWorkflowSteps({})).toEqual([]);
  });

  it('returns parsed steps from workflowSnapshot when present', () => {
    const steps = getWorkflowSteps({
      workflowSnapshot: originalSteps,
      workflow: { steps: [] },
    });
    expect(steps).toHaveLength(3);
    expect(steps[0].name).toBe('draft');
  });

  it('snapshot takes priority over changed template', () => {
    const snapshot = [
      { name: 'old_step', displayName: '旧版步骤', role: 'backend_developer', requiredReports: [] as string[], autoAdvance: false },
    ];
    const newTemplate = [
      { name: 'new_step', displayName: '新版步骤', role: 'cto', requiredReports: [] as string[], autoAdvance: false },
    ];
    const steps = getWorkflowSteps({
      workflowSnapshot: snapshot,
      workflow: { steps: newTemplate },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe('old_step');
    expect(steps[0].displayName).toBe('旧版步骤');
  });

  it('legacy fallback: returns steps from workflow.steps when snapshot is absent', () => {
    const steps = getWorkflowSteps({
      workflow: { steps: originalSteps },
    });
    expect(steps).toHaveLength(3);
    expect(steps[0].name).toBe('draft');
  });

  it('legacy fallback: null workflowSnapshot falls back to workflow.steps', () => {
    const steps = getWorkflowSteps({
      workflowSnapshot: null,
      workflow: { steps: originalSteps },
    });
    expect(steps).toHaveLength(3);
    expect(steps[0].name).toBe('draft');
  });

  it('parses snapshot in array format (preserves roleUserMap via extractRoleUserMap)', () => {
    const snapshotArray = [
      { name: 'step1', displayName: '步骤1', role: 'developer', requiredReports: [] as string[], autoAdvance: false },
    ];
    const steps = getWorkflowSteps({
      workflowSnapshot: snapshotArray,
      workflow: { steps: [] },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].role).toBe('developer');
    // Array format has no roleUserMap at top level
    expect(extractRoleUserMap(snapshotArray)).toBeUndefined();
  });

  it('parses snapshots in object {steps, roleUserMap} format and preserves roleUserMap', () => {
    const snapshotObject = {
      steps: [
        { name: 'step1', displayName: '步骤1', role: 'backend_developer', requiredReports: [] as string[], autoAdvance: false },
      ],
      roleUserMap: { backend_developer: 'user-uuid-123' },
    };
    const steps = getWorkflowSteps({
      workflowSnapshot: snapshotObject,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].role).toBe('backend_developer');

    // extractRoleUserMap preserves the map from object format
    const map = extractRoleUserMap(snapshotObject);
    expect(map).toEqual({ backend_developer: 'user-uuid-123' });
  });

  it('object format without steps field returns empty array', () => {
    const steps = getWorkflowSteps({
      workflowSnapshot: { roleUserMap: {} },
    });
    expect(steps).toEqual([]);
  });
});

describe('extractRoleUserMap (snapshot compat)', () => {
  it('returns undefined for array format', () => {
    const arr = [{ name: 's', displayName: 'S', role: 'dev', requiredReports: [] as string[], autoAdvance: false }];
    expect(extractRoleUserMap(arr)).toBeUndefined();
  });

  it('returns roleUserMap from object format', () => {
    const obj = { steps: [], roleUserMap: { dev: 'user-1' } };
    expect(extractRoleUserMap(obj)).toEqual({ dev: 'user-1' });
  });

  it('returns undefined for null', () => {
    expect(extractRoleUserMap(null)).toBeUndefined();
  });

  it('returns undefined for primitive values', () => {
    expect(extractRoleUserMap('string')).toBeUndefined();
    expect(extractRoleUserMap(42)).toBeUndefined();
  });
});

// ── Route registration dedup ─────────────────────────────

describe('route registration — /mine dedup', () => {
  it('registers exactly one /mine handler across kanban + mine', async () => {
    const { default: express } = await import('express');
    const router = express.Router();
    const { registerCoreKanbanRoutes } = await import('../routes/requirements/core-kanban.js');
    const { registerCoreMineRoutes } = await import('../routes/requirements/core-mine.js');
    registerCoreKanbanRoutes(router);
    registerCoreMineRoutes(router);
    const layers = router.stack.filter((l: any) => l.route?.path === '/mine');
    expect(layers).toHaveLength(1);
  });
});
