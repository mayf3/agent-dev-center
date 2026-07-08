/**
 * Tests for RequirementEventLedger v0 — main-rebase integration
 *
 * Covers: service, events API, field correctness, secrets, stateVersion
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const UUID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '11111111-1111-1111-1111-111111111111';

const { mockLedgerCreate, mockFindUnique, mockLedgerFindMany } = vi.hoisted(() => ({
  mockLedgerCreate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockLedgerFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: {
      findUnique: mockFindUnique,
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workflowTransition: { create: vi.fn(), findMany: vi.fn() },
    requirementReport: { findMany: vi.fn(), findFirst: vi.fn() },
    requirementEventLedger: { create: mockLedgerCreate, findMany: mockLedgerFindMany },
    requirementAuditLog: { create: vi.fn() },
    testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: any) => {
      const tx = {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ id: UUID, stateVersion: 0 }),
          update: vi.fn().mockResolvedValue({ id: UUID, stateVersion: 1 }),
        },
        workflowTransition: { create: vi.fn().mockResolvedValue({ id: 'transition-1' }) },
        requirementEventLedger: { create: mockLedgerCreate },
        requirementReport: { update: vi.fn(), create: vi.fn() },
        requirementAuditLog: { create: vi.fn() },
        testEnvLock: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
        user: { findUnique: vi.fn(), findFirst: vi.fn() },
      };
      return cb(tx);
    }),
  },
}));

// ══════════════════════════════════════════════════════════════
// Service-level tests
// ══════════════════════════════════════════════════════════════

describe('RequirementEventLedger v0', () => {
  let recordRequirementEvent: any;
  let buildWorkflowEvent: any;
  let RequirementEventType: any;
  let RequirementReasonCode: any;

  beforeAll(async () => {
    const svc = await vi.importActual('../services/requirement-event-ledger-service.js');
    recordRequirementEvent = svc.recordRequirementEvent;
    buildWorkflowEvent = svc.buildWorkflowEvent;
    const types = await vi.importActual('../lib/requirement-event-types.js');
    RequirementEventType = types.RequirementEventType;
    const codes = await vi.importActual('../lib/requirement-reason-codes.js');
    RequirementReasonCode = codes.RequirementReasonCode;
  });

  beforeEach(() => { vi.clearAllMocks(); });

  // Basic service
  describe('recordRequirementEvent', () => {
    it('creates event with required fields', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await recordRequirementEvent(mp, { requirementId: UUID, eventType: RequirementEventType.WORKFLOW_ADVANCED });
      expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
      expect(mockLedgerCreate.mock.calls[0][0].data.requirementId).toBe(UUID);
      expect(mockLedgerCreate.mock.calls[0][0].data.actorType).toBe('system');
    });

    it('throws on missing requirementId', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await expect(recordRequirementEvent(mp, { requirementId: '', eventType: 'X' })).rejects.toThrow('requirementId');
    });

    it('throws on missing eventType', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await expect(recordRequirementEvent(mp, { requirementId: UUID, eventType: '' })).rejects.toThrow('eventType');
    });
  });

  // Event types
  it('WORKFLOW_ADVANCED with step+stateVersion', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, buildWorkflowEvent(RequirementEventType.WORKFLOW_ADVANCED, {
      requirementId: UUID, fromStep: 'dev_self_check', toStep: 'arch_review',
      fromAssigneeId: USER_ID, toAssigneeId: 'architect-id',
      actorId: USER_ID, actorName: '开发者', reasonCode: RequirementReasonCode.UNKNOWN,
      reasonText: '代码质量符合标准', relatedTransitionId: 't-1',
      stateVersionBefore: 0, stateVersionAfter: 1,
    }));
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('WORKFLOW_ADVANCED');
    expect(d.stateVersionBefore).toBe(0);
    expect(d.stateVersionAfter).toBe(1);
    expect(d.relatedTransitionId).toBe('t-1');
  });

  it('WORKFLOW_REJECTED with reason', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, buildWorkflowEvent(RequirementEventType.WORKFLOW_REJECTED, {
      requirementId: UUID, fromStep: 'arch_review', toStep: 'dev_self_check',
      actorId: USER_ID, actorName: '架构师', reasonText: '方案不合理',
      reasonCode: RequirementReasonCode.UNKNOWN, relatedTransitionId: 't-rej',
    }));
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('WORKFLOW_REJECTED');
    expect(d.reasonText).toBe('方案不合理');
  });

  it('WORKFLOW_ASSIGNED with metadata', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, buildWorkflowEvent(RequirementEventType.WORKFLOW_ASSIGNED, {
      requirementId: UUID, toStep: 'draft', toAssigneeId: USER_ID,
      actorId: USER_ID, actorName: 'CTO', reasonText: 'Assign',
      relatedTransitionId: 't-asgn',
      metadata: { templateName: 'backend-dev', workflowId: 'wf-1' },
    }));
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('WORKFLOW_ASSIGNED');
    expect(d.metadata.templateName).toBe('backend-dev');
  });

  it('REPORT_SUBMITTED with relatedReportId', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, {
      requirementId: UUID, eventType: RequirementEventType.REPORT_SUBMITTED,
      actorId: USER_ID, actorName: '开发者', relatedReportId: 'r-1',
      metadata: { reportType: 'DEV_SELF_CHECK' },
    });
    expect(mockLedgerCreate.mock.calls[0][0].data.relatedReportId).toBe('r-1');
  });

  it('REPORT_REJECTED with reason', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, {
      requirementId: UUID, eventType: RequirementEventType.REPORT_REJECTED,
      relatedReportId: 'r-3', reasonText: '覆盖率不足', reasonCode: RequirementReasonCode.UNKNOWN,
    });
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('REPORT_REJECTED');
    expect(d.reasonText).toBe('覆盖率不足');
  });

  it('REPORT_APPROVED with metadata', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, {
      requirementId: UUID, eventType: RequirementEventType.REPORT_APPROVED,
      relatedReportId: 'r-4', reasonCode: RequirementReasonCode.UNKNOWN,
      metadata: { reportType: 'TEST_REPORT', oldStatus: 'pending', newStatus: 'approved' },
    });
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('REPORT_APPROVED');
    expect(d.metadata.oldStatus).toBe('pending');
    expect(d.metadata.newStatus).toBe('approved');
  });

  it('DRAFT_SUBMITTED with relatedTransitionId', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, buildWorkflowEvent(RequirementEventType.DRAFT_SUBMITTED, {
      requirementId: UUID, fromStep: 'draft', toStep: 'submitted',
      actorId: USER_ID, actorName: '需求提出者', reasonText: '提交审批',
      relatedTransitionId: 't-submit',
    }));
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('DRAFT_SUBMITTED');
    expect(d.relatedTransitionId).toBe('t-submit');
  });

  it('LIFECYCLE_ABANDONED with from/to step', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, {
      requirementId: UUID, eventType: RequirementEventType.LIFECYCLE_ABANDONED,
      fromStep: 'rejected', toStep: 'abandoned', actorId: USER_ID,
    });
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.fromStep).toBe('rejected');
    expect(d.toStep).toBe('abandoned');
  });

  it('LIFECYCLE_REACTIVATED', async () => {
    const mp = { requirementEventLedger: { create: mockLedgerCreate } };
    await recordRequirementEvent(mp, {
      requirementId: UUID, eventType: RequirementEventType.LIFECYCLE_REACTIVATED,
      fromStep: 'abandoned', toStep: 'draft', actorId: USER_ID,
    });
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('LIFECYCLE_REACTIVATED');
  });

  // Field correctness
  describe('Field correctness', () => {
    it('preserves reasonText', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await recordRequirementEvent(mp, { requirementId: UUID, eventType: 'X', reasonText: 'test-text' });
      expect(mockLedgerCreate.mock.calls[0][0].data.reasonText).toBe('test-text');
    });

    it('supports stateVersionBefore/After', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await recordRequirementEvent(mp, { requirementId: UUID, eventType: 'X', stateVersionBefore: 2, stateVersionAfter: 3 });
      expect(mockLedgerCreate.mock.calls[0][0].data.stateVersionBefore).toBe(2);
      expect(mockLedgerCreate.mock.calls[0][0].data.stateVersionAfter).toBe(3);
    });

    it('defaults actorType to system', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await recordRequirementEvent(mp, { requirementId: UUID, eventType: 'X' });
      expect(mockLedgerCreate.mock.calls[0][0].data.actorType).toBe('system');
    });

    it('strips secrets from metadata', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await recordRequirementEvent(mp, {
        requirementId: UUID, eventType: 'X',
        metadata: { reportType: 'TEST', token: 'secret', password: 'pw', DATABASE_URL: 'psql://...' },
      });
      const d = mockLedgerCreate.mock.calls[0][0].data;
      expect(d.metadata.token).toBeUndefined();
      expect(d.metadata.password).toBeUndefined();
      expect(d.metadata.DATABASE_URL).toBeUndefined();
      expect(d.metadata.reportType).toBe('TEST');
    });

    // reasonCode contract
    it('reasonCode null when omitted', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await recordRequirementEvent(mp, { requirementId: UUID, eventType: 'X' });
      expect(mockLedgerCreate.mock.calls[0][0].data.reasonCode).toBeUndefined();
    });

    it('reasonCode UNKNOWN when set explicitly', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await recordRequirementEvent(mp, { requirementId: UUID, eventType: 'X', reasonCode: 'UNKNOWN' });
      expect(mockLedgerCreate.mock.calls[0][0].data.reasonCode).toBe('UNKNOWN');
    });
  });

  // Service rollback
  describe('Service rollback', () => {
    it('ledger write failure propagates error', async () => {
      const mp = { requirementEventLedger: { create: vi.fn(() => { throw new Error('db error'); }) } };
      await expect(recordRequirementEvent(mp, { requirementId: UUID, eventType: 'X' })).rejects.toThrow('db error');
    });

    it('validates before DB write', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await expect(recordRequirementEvent(mp, { requirementId: '', eventType: 'X' })).rejects.toThrow('requirementId');
      expect(mockLedgerCreate).not.toHaveBeenCalled();
    });
  });
});

// ══════════════════════════════════════════════════════════════
// Events Read API tests
// ══════════════════════════════════════════════════════════════

describe('Events Read API', () => {
  let registerEventRoutesFn: any;

  beforeAll(async () => {
    const mod = await vi.importActual('../routes/requirements/events.js');
    registerEventRoutesFn = mod.registerEventRoutes;
  });

  beforeEach(() => { vi.clearAllMocks(); });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: USER_ID, name: 'Dev', email: 'dev@t.local', role: 'admin' } as any;
      next();
    });
    const router = express.Router();
    registerEventRoutesFn(router);
    app.use('/api/requirements', router);
    return app;
  }

  it('returns events sorted asc', async () => {
    mockFindUnique.mockResolvedValue({ id: UUID, requesterId: USER_ID, requester: 'R', assigneeId: USER_ID, assignee: 'A' });
    mockLedgerFindMany.mockResolvedValue([
      { id: 'e1', requirementId: UUID, eventType: 'WFA', createdAt: new Date('2026-01-01'), metadata: {} },
      { id: 'e2', requirementId: UUID, eventType: 'WFR', createdAt: new Date('2026-01-02'), metadata: {} },
    ]);
    const sv = http.createServer(createApp());
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/events`);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].eventType).toBe('WFA');
    sv.close();
  });

  it('404 for non-existent requirement', async () => {
    mockFindUnique.mockResolvedValue(null);
    const sv = http.createServer(createApp());
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/events`);
    expect(res.status).toBe(404);
    sv.close();
  });

  it('filters by eventType', async () => {
    mockFindUnique.mockResolvedValue({ id: UUID, requesterId: USER_ID, requester: 'R', assigneeId: USER_ID, assignee: 'A' });
    mockLedgerFindMany.mockResolvedValue([{ id: 'e3', requirementId: UUID, eventType: 'WFR', createdAt: new Date(), metadata: {} }]);
    const sv = http.createServer(createApp());
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/events?eventType=WFR`);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].eventType).toBe('WFR');
    expect(mockLedgerFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventType: 'WFR' }),
    }));
    sv.close();
  });

  it('supports limit', async () => {
    mockFindUnique.mockResolvedValue({ id: UUID, requesterId: USER_ID, requester: 'R', assigneeId: USER_ID, assignee: 'A' });
    mockLedgerFindMany.mockResolvedValue([]);
    const sv = http.createServer(createApp());
    await new Promise<void>(r => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    await fetch(`http://localhost:${port}/api/requirements/${UUID}/events?limit=5`);
    expect(mockLedgerFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    sv.close();
  });
});

// ══════════════════════════════════════════════════════════════
// PR-2A event type tests
// ══════════════════════════════════════════════════════════════

describe('RequirementEventLedger PR-2A events', () => {
  let rec: any;
  let ET: any;

  beforeAll(async () => {
    const svc = await vi.importActual('../services/requirement-event-ledger-service.js');
    rec = svc.recordRequirementEvent;
    const t = await vi.importActual('../lib/requirement-event-types.js');
    ET = t.RequirementEventType;
  });

  beforeEach(() => { vi.clearAllMocks(); });

  describe('REQUIREMENT_CREATED', () => {
    it('records REQUIREMENT_CREATED with stateVersion and metadata', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await rec(mp, {
        requirementId: UUID, eventType: ET.REQUIREMENT_CREATED,
        actorId: USER_ID, actorName: 'creator', actorType: 'human',
        toStatus: 'pending', toAssigneeId: USER_ID,
        stateVersionBefore: null, stateVersionAfter: 0,
        metadata: { type: 'FEATURE', priority: 'P2', department: 'tech', hasAssignee: true },
        source: 'api.requirements.create',
      });
      const d = mockLedgerCreate.mock.calls[0][0].data;
      expect(d.eventType).toBe('REQUIREMENT_CREATED');
      expect(d.stateVersionBefore).toBeUndefined();
      expect(d.stateVersionAfter).toBe(0);
      expect(Object.keys(d.metadata)).not.toContain('description');
    });

    it('ledger failure rolls back REQUIREMENT_CREATED', async () => {
      const mp = { requirementEventLedger: { create: vi.fn(() => { throw new Error('ledger error'); }) } };
      await expect(rec(mp, { requirementId: UUID, eventType: ET.REQUIREMENT_CREATED })).rejects.toThrow('ledger error');
    });
  });

  describe('PATCH_UPDATED', () => {
    it('records PATCH_UPDATED with changedFields and assignee change', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await rec(mp, {
        requirementId: UUID, eventType: ET.PATCH_UPDATED,
        actorId: USER_ID, actorName: 'op', actorType: 'human',
        fromStep: 'pm_review', toStep: 'draft',
        fromAssigneeId: 'old-a', toAssigneeId: 'new-a',
        stateVersionBefore: 2, stateVersionAfter: 3,
        metadata: { changedFields: ['currentStep', 'assignee'], hasAssigneeChange: true, hasStepChange: true },
        source: 'api.requirements.patch',
      });
      const d = mockLedgerCreate.mock.calls[0][0].data;
      expect(d.eventType).toBe('PATCH_UPDATED');
      expect(d.fromStep).toBe('pm_review');
      expect(d.toStep).toBe('draft');
      expect(d.fromAssigneeId).toBe('old-a');
      expect(d.stateVersionBefore).toBe(2);
      expect(d.stateVersionAfter).toBe(3);
      expect(d.metadata.changedFields).toContain('assignee');
      expect(d.source).toBe('api.requirements.patch');
    });

    it('PATCH_UPDATED does NOT emit DOMAIN_CHANGED', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await rec(mp, { requirementId: UUID, eventType: ET.PATCH_UPDATED, metadata: { changedFields: ['title'] } });
      const d = mockLedgerCreate.mock.calls[0][0].data;
      expect(d.eventType).toBe('PATCH_UPDATED');
      expect(d.metadata.changedFields).not.toContain('domainKey');
    });
  });

  describe('LIFECYCLE_ARCHIVED', () => {
    it('records single LIFECYCLE_ARCHIVED with stateVersion and relatedAuditLogId', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await rec(mp, {
        requirementId: UUID, eventType: ET.LIFECYCLE_ARCHIVED,
        actorId: USER_ID, actorName: 'CTO', actorType: 'human',
        fromStep: 'done', toStep: 'archived',
        reasonCode: 'UNKNOWN', reasonText: 'proj closed',
        stateVersionBefore: 5, stateVersionAfter: 6,
        relatedAuditLogId: 'audit-log-1',
      });
      const d = mockLedgerCreate.mock.calls[0][0].data;
      expect(d.eventType).toBe('LIFECYCLE_ARCHIVED');
      expect(d.fromStep).toBe('done');
      expect(d.toStep).toBe('archived');
      expect(d.stateVersionBefore).toBe(5);
      expect(d.stateVersionAfter).toBe(6);
      expect(d.relatedAuditLogId).toBe('audit-log-1');
      expect(d.reasonText).toBe('proj closed');
    });

    it('records batch LIFECYCLE_ARCHIVED with metadata.batch=true', async () => {
      const mp = { requirementEventLedger: { create: mockLedgerCreate } };
      await rec(mp, { requirementId: UUID, eventType: ET.LIFECYCLE_ARCHIVED, fromStep: 'done', toStep: 'archived', metadata: { batch: true } });
      const d = mockLedgerCreate.mock.calls[0][0].data;
      expect(d.eventType).toBe('LIFECYCLE_ARCHIVED');
      expect(d.metadata.batch).toBe(true);
    });

    it('ledger failure rolls back LIFECYCLE_ARCHIVED', async () => {
      const mp = { requirementEventLedger: { create: vi.fn(() => { throw new Error('ledger error'); }) } };
      await expect(rec(mp, { requirementId: UUID, eventType: ET.LIFECYCLE_ARCHIVED })).rejects.toThrow('ledger error');
    });
  });
});
