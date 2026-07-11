/**
 * Tests for Requirement Audit Summary API
 *
 * Covers: pure functions (cycleSummary, timeline) and route (permissions, 404, happy path)
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { errorHandler } from '../middleware/error-handler.js';

const UUID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '11111111-1111-1111-1111-111111111111';

// ──────────────────────────────────────────────────────────────
// Pure function tests
// ──────────────────────────────────────────────────────────────

describe('computeCycleSummary', () => {
  let computeCycleSummary: any;
  let formatAuditTimeline: any;
  let buildRequirementAuditSummary: any;
  let AuditEventInput: any;

  beforeAll(async () => {
    const mod = await vi.importActual('../lib/requirement-audit-summary.js');
    computeCycleSummary = mod.computeCycleSummary;
    formatAuditTimeline = mod.formatAuditTimeline;
    buildRequirementAuditSummary = mod.buildRequirementAuditSummary;
  });

  function makeEvents(overrides: Partial<AuditEventInput>[]): any[] {
    return overrides.map((o, i) => ({
      id: `e${i}`,
      eventType: 'UNKNOWN',
      actorId: null,
      actorName: null,
      actorType: 'system',
      fromStep: null,
      toStep: null,
      reasonCode: null,
      reasonText: null,
      metadata: null,
      relatedReportId: null,
      relatedAuditLogId: null,
      createdAt: new Date('2026-01-01'),
      ...o,
    }));
  }

  // 1. Empty events
  it('returns all zeros and no loop for empty events', () => {
    const result = computeCycleSummary([]);
    expect(result.totalRejects).toBe(0);
    expect(result.workflowRejects).toBe(0);
    expect(result.reportRejects).toBe(0);
    expect(result.guardrailBlocks).toBe(0);
    expect(result.sameStepMaxRejectCount).toBe(0);
    expect(result.sameReasonCodeMaxCount).toBe(0);
    expect(result.suspectedLoop).toBe(false);
    expect(result.loopReasons).toEqual([]);
  });

  // 2. totalRejects >= 3
  it('suspectedLoop true when totalRejects >= 3', () => {
    const events = makeEvents([
      { eventType: 'WORKFLOW_REJECTED', fromStep: 'arch_review' },
      { eventType: 'WORKFLOW_REJECTED', fromStep: 'arch_review' },
      { eventType: 'REPORT_REJECTED', fromStep: 'dev_self_check' },
    ]);
    const result = computeCycleSummary(events);
    expect(result.totalRejects).toBe(3);
    expect(result.workflowRejects).toBe(2);
    expect(result.reportRejects).toBe(1);
    expect(result.suspectedLoop).toBe(true);
  });

  // 3. sameStepMaxRejectCount >= 2
  it('suspectedLoop true when sameStepMaxRejectCount >= 2', () => {
    const events = makeEvents([
      { eventType: 'WORKFLOW_REJECTED', fromStep: 'arch_review' },
      { eventType: 'WORKFLOW_REJECTED', fromStep: 'arch_review' },
    ]);
    const result = computeCycleSummary(events);
    expect(result.sameStepMaxRejectCount).toBe(2);
    expect(result.suspectedLoop).toBe(true);
  });

  // 4. sameReasonCodeMaxCount >= 3
  it('suspectedLoop true when sameReasonCodeMaxCount >= 3', () => {
    const events = makeEvents([
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'CODE_A', fromStep: 'step1' },
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'CODE_A', fromStep: 'step2' },
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'CODE_A', fromStep: 'step3' },
    ]);
    const result = computeCycleSummary(events);
    expect(result.sameReasonCodeMaxCount).toBe(3);
    expect(result.suspectedLoop).toBe(true);
  });

  // 5. guardrailBlocks >= 5
  it('suspectedLoop true when guardrailBlocks >= 5', () => {
    const events = makeEvents(Array.from({ length: 5 }, () => ({
      eventType: 'GUARDRAIL_BLOCKED',
    })));
    const result = computeCycleSummary(events);
    expect(result.guardrailBlocks).toBe(5);
    expect(result.suspectedLoop).toBe(true);
  });

  // 5b. guardrailBlocks < 5 does not trigger
  it('suspectedLoop false when guardrailBlocks < 5', () => {
    const events = makeEvents(Array.from({ length: 4 }, () => ({
      eventType: 'GUARDRAIL_BLOCKED',
    })));
    const result = computeCycleSummary(events);
    expect(result.guardrailBlocks).toBe(4);
    expect(result.suspectedLoop).toBe(false);
  });

  // 6. loopReasons sorted by count, max 5
  it('loopReasons sorted descending, max 5 entries', () => {
    const events = makeEvents([
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'REASON_B', fromStep: 's1' },
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'REASON_B', fromStep: 's2' },
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'REASON_B', fromStep: 's3' },  // count=3
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'REASON_A', fromStep: 's4' },
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'REASON_A', fromStep: 's5' },  // count=2
      { eventType: 'WORKFLOW_REJECTED', reasonCode: 'REASON_C', fromStep: 's6' },  // count=1 → excluded
    ]);
    const result = computeCycleSummary(events);
    // loopReasons: REASON_B (3), REASON_A (2) — both >= 2
    expect(result.loopReasons).toEqual(['REASON_B', 'REASON_A']);
    expect(result.loopReasons.length).toBeLessThanOrEqual(5);
  });

  it('loopReasons capped at 5', () => {
    const codes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const events = makeEvents(
      codes.flatMap((code) => [
        { eventType: 'WORKFLOW_REJECTED', reasonCode: `REASON_${code}`, fromStep: `s_${code}_1` },
        { eventType: 'WORKFLOW_REJECTED', reasonCode: `REASON_${code}`, fromStep: `s_${code}_2` },
      ]),
    );
    const result = computeCycleSummary(events);
    expect(result.loopReasons.length).toBeLessThanOrEqual(5);
  });

  // Step field can be null — should not error
  it('skips step counting when step is null', () => {
    const events = makeEvents([
      { eventType: 'WORKFLOW_REJECTED', fromStep: null, toStep: null },
      { eventType: 'WORKFLOW_REJECTED', fromStep: null, toStep: null },
    ]);
    const result = computeCycleSummary(events);
    expect(result.sameStepMaxRejectCount).toBe(0);
    expect(result.totalRejects).toBe(2);
  });

  // Guardrail blocks counting
  it('counts guardrail blocks correctly', () => {
    const events = makeEvents([
      { eventType: 'GUARDRAIL_BLOCKED' },
      { eventType: 'GUARDRAIL_BLOCKED' },
      { eventType: 'WORKFLOW_ADVANCED' },
    ]);
    const result = computeCycleSummary(events);
    expect(result.guardrailBlocks).toBe(2);
    expect(result.suspectedLoop).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// Timeline format tests
// ──────────────────────────────────────────────────────────────

describe('formatAuditTimeline', () => {
  let formatAuditTimeline: any;

  beforeAll(async () => {
    const mod = await vi.importActual('../lib/requirement-audit-summary.js');
    formatAuditTimeline = mod.formatAuditTimeline;
  });

  function makeEvent(overrides: Record<string, unknown> = {}): any {
    return {
      id: 'e-1',
      eventType: 'REPORT_SUBMITTED',
      actorId: null,
      actorName: 'Dev Agent',
      actorType: 'agent',
      fromStep: null,
      toStep: null,
      reasonCode: null,
      reasonText: null,
      metadata: null,
      relatedReportId: null,
      relatedAuditLogId: null,
      createdAt: new Date('2026-07-09T10:12:00.000Z'),
      ...overrides,
    };
  }

  // 7. timeline preserves relatedReportId / reasonText / metadata
  it('preserves relatedReportId, reasonText, metadata in timeline', () => {
    const item = formatAuditTimeline([makeEvent({
      relatedReportId: 'report-1',
      reasonText: '覆盖率不足',
      metadata: { reportType: 'DEV_SELF_CHECK' },
    })])[0];
    expect(item.relatedReportId).toBe('report-1');
    expect(item.reasonText).toBe('覆盖率不足');
    expect(item.metadata).toEqual({ reportType: 'DEV_SELF_CHECK' });
  });

  // 8. unknown eventType summary fallback
  it('uses eventType as summary for unknown event types', () => {
    const item = formatAuditTimeline([makeEvent({ eventType: 'CUSTOM_EVENT' })])[0];
    expect(item.summary).toBe('CUSTOM_EVENT');
  });

  it('uses mapped summary for known event types', () => {
    const tests: [string, string][] = [
      ['REQUIREMENT_CREATED', '创建需求'],
      ['PATCH_UPDATED', '更新需求'],
      ['WORKFLOW_ASSIGNED', '分配工作流'],
      ['DRAFT_SUBMITTED', '提交草稿'],
      ['WORKFLOW_ADVANCED', '推进流程'],
      ['WORKFLOW_REJECTED', '流程被打回'],
      ['REPORT_SUBMITTED', '提交报告'],
      ['REPORT_APPROVED', '报告通过'],
      ['REPORT_REJECTED', '报告被打回'],
      ['GUARDRAIL_BLOCKED', '推进被阻止'],
      ['LIFECYCLE_ARCHIVED', '归档需求'],
      ['LIFECYCLE_ABANDONED', '放弃需求'],
      ['LIFECYCLE_REACTIVATED', '重新激活需求'],
    ];
    for (const [eventType, expected] of tests) {
      const item = formatAuditTimeline([makeEvent({ eventType })])[0];
      expect(item.summary).toBe(expected);
    }
  });

  it('includes fromStep and toStep in timeline', () => {
    const item = formatAuditTimeline([makeEvent({
      fromStep: 'dev_self_check',
      toStep: 'arch_review',
    })])[0];
    expect(item.fromStep).toBe('dev_self_check');
    expect(item.toStep).toBe('arch_review');
  });
});

// ──────────────────────────────────────────────────────────────
// buildRequirementAuditSummary integration
// ──────────────────────────────────────────────────────────────

describe('buildRequirementAuditSummary', () => {
  let buildRequirementAuditSummary: any;

  beforeAll(async () => {
    const mod = await vi.importActual('../lib/requirement-audit-summary.js');
    buildRequirementAuditSummary = mod.buildRequirementAuditSummary;
  });

  it('returns requirement basic info, cycleSummary, and timeline', () => {
    const requirement = {
      id: UUID,
      title: '测试需求',
      status: 'active',
      currentStep: 'dev_self_check',
      assigneeId: USER_ID,
      assigneeName: 'Dev',
      requesterId: USER_ID,
      requesterName: 'Requester',
    };
    const events = [
      {
        id: 'e1',
        eventType: 'REQUIREMENT_CREATED',
        actorId: null,
        actorName: null,
        actorType: 'system',
        fromStep: null,
        toStep: null,
        reasonCode: null,
        reasonText: null,
        metadata: null,
        relatedReportId: null,
        relatedAuditLogId: null,
        createdAt: new Date('2026-01-01'),
      },
    ];
    const result = buildRequirementAuditSummary(requirement, events);
    expect(result.requirement.id).toBe(UUID);
    expect(result.requirement.title).toBe('测试需求');
    expect(result.cycleSummary).toBeDefined();
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].summary).toBe('创建需求');
  });
});

// ──────────────────────────────────────────────────────────────
// Route-level tests
// ──────────────────────────────────────────────────────────────

const { mockFindUnique, mockLedgerFindMany } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLedgerFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: {
      findUnique: mockFindUnique,
    },
    requirementEventLedger: {
      findMany: mockLedgerFindMany,
    },
  },
}));

describe('Audit Summary Route', () => {
  let registerAuditSummaryRoutesFn: any;

  beforeAll(async () => {
    const mod = await vi.importActual('../routes/requirements/audit-summary.js');
    registerAuditSummaryRoutesFn = mod.registerAuditSummaryRoutes;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createApp(authUser?: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = authUser ?? { id: USER_ID, name: 'Dev', email: 'dev@t.local', role: 'admin' } as any;
      next();
    });
    const router = express.Router();
    registerAuditSummaryRoutesFn(router);
    app.use('/api/requirements', router);
    app.use(errorHandler);
    return app;
  }

  // 9. No permission cannot read
  it('returns 403 when user lacks permission', async () => {
    // Requirement exists but user can't read it
    mockFindUnique.mockResolvedValueOnce({
      id: UUID,
      requesterId: 'other-user-id',
      requester: 'Other',
      assigneeId: 'other-assignee-id',
      assignee: 'Other Assignee',
    });
    const sv = http.createServer(createApp({
      id: USER_ID,
      name: 'Dev',
      email: 'dev@t.local',
      role: 'developer',
    }));
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/audit-summary`);
    expect(res.status).toBe(403);
    sv.close();
  });

  // 10. Non-existent requirement returns 404
  it('returns 404 when requirement does not exist', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const sv = http.createServer(createApp());
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/audit-summary`);
    expect(res.status).toBe(404);
    sv.close();
  });

  // Happy path
  it('returns audit summary with cycleSummary and timeline', async () => {
    // First call: ensureReadableRequirement (findUnique with select id/requesterId/etc)
    mockFindUnique.mockResolvedValueOnce({
      id: UUID,
      requesterId: USER_ID,
      requester: 'Requester',
      assigneeId: USER_ID,
      assignee: 'Dev',
    });
    // Second call: full requirement info
    mockFindUnique.mockResolvedValueOnce({
      id: UUID,
      title: 'Test Requirement',
      status: 'active',
      currentStep: 'dev_self_check',
      assigneeId: USER_ID,
      assignee: 'Dev',
      requesterId: USER_ID,
      requester: 'Requester',
    });
    mockLedgerFindMany.mockResolvedValueOnce([
      {
        id: 'e1',
        eventType: 'REQUIREMENT_CREATED',
        actorId: null,
        actorName: null,
        actorType: 'system',
        fromStep: null,
        toStep: null,
        reasonCode: null,
        reasonText: null,
        metadata: {},
        relatedReportId: null,
        relatedAuditLogId: null,
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const sv = http.createServer(createApp());
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/audit-summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.requirement.id).toBe(UUID);
    expect(body.data.cycleSummary).toBeDefined();
    expect(body.data.cycleSummary.suspectedLoop).toBe(false);
    expect(body.data.timeline).toHaveLength(1);
    expect(body.data.timeline[0].summary).toBe('创建需求');
    sv.close();
  });

  it('returns 400 for invalid UUID', async () => {
    const sv = http.createServer(createApp());
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/requirements/not-a-uuid/audit-summary`);
    expect(res.status).toBe(400);
    sv.close();
  });
});
