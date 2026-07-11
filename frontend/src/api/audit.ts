/**
 * Audit / Event Ledger API
 *
 * Types and functions for fetching requirement event ledger
 * and audit summary from the backend.
 *
 * @see backend/src/routes/requirements/events.ts
 * @see backend/src/routes/requirements/audit-summary.ts
 * @see backend/src/lib/requirement-audit-summary.ts
 */
import { apiClient } from './client';

// ──────────────────────────────────────────────
// Event (from RequirementEventLedger)
// ──────────────────────────────────────────────

export interface RequirementEvent {
  id: string;
  requirementId: string;
  eventType: string;
  actorId: string | null;
  actorName: string | null;
  actorType: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromStep: string | null;
  toStep: string | null;
  fromAssigneeId: string | null;
  toAssigneeId: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  evidence: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  relatedReportId: string | null;
  relatedAuditLogId: string | null;
  stateVersionBefore: number | null;
  stateVersionAfter: number | null;
  correlationId: string | null;
  source: string | null;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Audit Summary (from RequirementAuditSummary)
// ──────────────────────────────────────────────

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
  at: string;
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

// ──────────────────────────────────────────────
// API Response Envelope (backend wraps in { success, data })
// ──────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// ──────────────────────────────────────────────
// API Functions
// ──────────────────────────────────────────────

export const auditApi = {
  /**
   * Fetch event ledger for a requirement, ordered by createdAt ascending.
   */
  fetchEvents(requirementId: string): Promise<RequirementEvent[]> {
    return apiClient
      .get<ApiResponse<RequirementEvent[]>>(`/requirements/${requirementId}/events`)
      .then((res) => res.data.data);
  },

  /**
   * Fetch audit summary for a requirement.
   */
  fetchAuditSummary(requirementId: string): Promise<RequirementAuditSummary> {
    return apiClient
      .get<ApiResponse<RequirementAuditSummary>>(`/requirements/${requirementId}/audit-summary`)
      .then((res) => res.data.data);
  },
};
