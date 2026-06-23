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
    expect(result).toEqual({ ok: false, missing: ['DEV_SELF_CHECK', 'TEST_REPORT', 'CTO_REVIEW'] });
  });
});

// ── Outcome steps ─────────────────────────────────────

const outcomeSteps = [
  { name: 'testing', displayName: '测试', role: 'tester', requiredReports: ['TEST_REPORT'], autoAdvance: false,
    outcomes: {
      passed: { targetStep: 'qa_pre_release', description: '测试通过，进入预发布审查' },
      failed: { targetStep: 'dev_self_check', description: '测试不通过，退回开发修复' },
    },
  },
  { name: 'dev_self_check', displayName: '开发自检', role: 'developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
  { name: 'qa_pre_release', displayName: '预发布审查', role: 'qa', requiredReports: [], autoAdvance: false },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];

const gateSteps = [
  { name: 'arch_review', displayName: '架构审查', role: 'architect', requiredReports: ['ARCH_REVIEW'], autoAdvance: false,
    gates: { reportCheckMode: 'approved' as const },
  },
  { name: 'dev_self_check', displayName: '开发自检', role: 'developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];

describe('parseSteps with outcomes', () => {
  it('parses steps with outcome definitions', () => {
    const result = parseSteps(outcomeSteps);
    expect(result).toHaveLength(4);
    expect(result[0].outcomes).toBeDefined();
    expect(result[0].outcomes!['passed'].targetStep).toBe('qa_pre_release');
    expect(result[0].outcomes!['failed'].targetStep).toBe('dev_self_check');
  });

  it('parses steps with gate definitions', () => {
    const result = parseSteps(gateSteps);
    expect(result).toHaveLength(3);
    expect(result[0].gates).toBeDefined();
    expect(result[0].gates!.reportCheckMode).toBe('approved');
  });
});
