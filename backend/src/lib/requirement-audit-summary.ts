/**
 * Requirement Audit Summary — pure aggregation logic
 *
 * Builds the cycleSummary and timeline for the audit-summary endpoint.
 * No database access, no side effects.
 */

// ────────────────────────────────────────────────────────────────
// Event shape used as input (subset of RequirementEventLedger)
// ────────────────────────────────────────────────────────────────
export interface AuditEventInput {
  id: string;
  eventType: string;
  actorId?: string | null;
  actorName?: string | null;
  actorType?: string;
  fromStep?: string | null;
  toStep?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  metadata?: Record<string, unknown> | null;
  relatedReportId?: string | null;
  relatedAuditLogId?: string | null;
  createdAt: Date;
}

// ────────────────────────────────────────────────────────────────
// Output types
// ────────────────────────────────────────────────────────────────
export interface CycleSummary {
  totalRejects: number;
  workflowRejects: number;
  reportRejects: number;
  guardrailBlocks: number;
  sameStepMaxRejectCount: number;
  sameReasonCodeMaxCount: number;
  suspectedLoop: boolean;
  loopReasons: string[];
}

export interface TimelineItem {
  id: string;
  at: string; // ISO string
  eventType: string;
  fromStep: string | null;
  toStep: string | null;
  actorId: string | null;
  actorName: string | null;
  actorType: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  relatedReportId: string | null;
  relatedAuditLogId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
}

export interface RequirementAuditSummary {
  requirement: {
    id: string;
    title: string;
    status: string;
    currentStep: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    requesterId: string | null;
    requesterName: string | null;
  };
  cycleSummary: CycleSummary;
  timeline: TimelineItem[];
}

// ────────────────────────────────────────────────────────────────
// Summary text mapping
// ────────────────────────────────────────────────────────────────
const EVENT_SUMMARY: Record<string, string> = {
  REQUIREMENT_CREATED: '创建需求',
  PATCH_UPDATED: '更新需求',
  WORKFLOW_ASSIGNED: '分配工作流',
  DRAFT_SUBMITTED: '提交草稿',
  WORKFLOW_ADVANCED: '推进流程',
  WORKFLOW_REJECTED: '流程被打回',
  REPORT_SUBMITTED: '提交报告',
  REPORT_APPROVED: '报告通过',
  REPORT_REJECTED: '报告被打回',
  GUARDRAIL_BLOCKED: '推进被阻止',
  LIFECYCLE_ARCHIVED: '归档需求',
  LIFECYCLE_ABANDONED: '放弃需求',
  LIFECYCLE_REACTIVATED: '重新激活需求',
};

function getEventSummary(eventType: string): string {
  return EVENT_SUMMARY[eventType] ?? eventType;
}

// ────────────────────────────────────────────────────────────────
// Cycle summary computation
// ────────────────────────────────────────────────────────────────
const REJECT_EVENT_TYPES = new Set(['WORKFLOW_REJECTED', 'REPORT_REJECTED']);

export function computeCycleSummary(events: AuditEventInput[]): CycleSummary {
  let workflowRejects = 0;
  let reportRejects = 0;
  let guardrailBlocks = 0;

  // Count same-step reject occurrences by step field
  const stepRejectCount = new Map<string, number>();

  // Count reasonCode occurrences (non-null)
  const reasonCodeCount = new Map<string, number>();

  // Collect loopReasons (reasonCode with count >= 2)
  const loopReasonCounts = new Map<string, number>();

  for (const ev of events) {
    if (ev.eventType === 'WORKFLOW_REJECTED') {
      workflowRejects++;
    } else if (ev.eventType === 'REPORT_REJECTED') {
      reportRejects++;
    } else if (ev.eventType === 'GUARDRAIL_BLOCKED') {
      guardrailBlocks++;
    }

    // Count by step for reject events
    if (REJECT_EVENT_TYPES.has(ev.eventType)) {
      // Use fromStep as the reject occurrence step; fallback to toStep or current step indicator
      const step = ev.fromStep ?? ev.toStep;
      if (step) {
        stepRejectCount.set(step, (stepRejectCount.get(step) ?? 0) + 1);
      }
    }

    // Count reasonCode occurrences
    if (ev.reasonCode) {
      reasonCodeCount.set(ev.reasonCode, (reasonCodeCount.get(ev.reasonCode) ?? 0) + 1);

      // Track for loopReasons (count >= 2)
      const count = reasonCodeCount.get(ev.reasonCode)!;
      if (count >= 2) {
        loopReasonCounts.set(ev.reasonCode, count);
      }
    }
  }

  const totalRejects = workflowRejects + reportRejects;

  let sameStepMaxRejectCount = 0;
  for (const count of stepRejectCount.values()) {
    if (count > sameStepMaxRejectCount) {
      sameStepMaxRejectCount = count;
    }
  }

  let sameReasonCodeMaxCount = 0;
  for (const count of reasonCodeCount.values()) {
    if (count > sameReasonCodeMaxCount) {
      sameReasonCodeMaxCount = count;
    }
  }

  // suspectedLoop based on threshold rules
  const suspectedLoop =
    totalRejects >= 3 ||
    sameStepMaxRejectCount >= 2 ||
    sameReasonCodeMaxCount >= 3 ||
    guardrailBlocks >= 5;

  // loopReasons: reasonCode with count >= 2, sorted descending, max 5
  const loopReasons = [...loopReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code]) => code);

  return {
    totalRejects,
    workflowRejects,
    reportRejects,
    guardrailBlocks,
    sameStepMaxRejectCount,
    sameReasonCodeMaxCount,
    suspectedLoop,
    loopReasons,
  };
}

// ────────────────────────────────────────────────────────────────
// Timeline formatting
// ────────────────────────────────────────────────────────────────
export function formatAuditTimeline(events: AuditEventInput[]): TimelineItem[] {
  return events.map((ev) => ({
    id: ev.id,
    at: ev.createdAt instanceof Date ? ev.createdAt.toISOString() : String(ev.createdAt),
    eventType: ev.eventType,
    fromStep: ev.fromStep ?? null,
    toStep: ev.toStep ?? null,
    actorId: ev.actorId ?? null,
    actorName: ev.actorName ?? null,
    actorType: ev.actorType ?? null,
    reasonCode: ev.reasonCode ?? null,
    reasonText: ev.reasonText ?? null,
    relatedReportId: ev.relatedReportId ?? null,
    relatedAuditLogId: ev.relatedAuditLogId ?? null,
    summary: getEventSummary(ev.eventType),
    metadata: ev.metadata ?? null,
  }));
}

// ────────────────────────────────────────────────────────────────
// Top-level builder
// ────────────────────────────────────────────────────────────────
export interface RequirementBasicInfo {
  id: string;
  title: string;
  status: string;
  currentStep: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  requesterId: string | null;
  requesterName: string | null;
}

export function buildRequirementAuditSummary(
  requirement: RequirementBasicInfo,
  events: AuditEventInput[],
): RequirementAuditSummary {
  return {
    requirement: {
      id: requirement.id,
      title: requirement.title,
      status: requirement.status,
      currentStep: requirement.currentStep,
      assigneeId: requirement.assigneeId,
      assigneeName: requirement.assigneeName,
      requesterId: requirement.requesterId,
      requesterName: requirement.requesterName,
    },
    cycleSummary: computeCycleSummary(events),
    timeline: formatAuditTimeline(events),
  };
}
