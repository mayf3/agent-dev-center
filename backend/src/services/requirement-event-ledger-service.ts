import { RequirementEventType } from '../lib/requirement-event-types.js';

export interface LedgerEventInput {
  requirementId: string;
  eventType: string;
  actorId?: string | null;
  actorName?: string | null;
  actorType?: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  fromStep?: string | null;
  toStep?: string | null;
  fromAssigneeId?: string | null;
  toAssigneeId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  evidence?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  stateVersionBefore?: number | null;
  stateVersionAfter?: number | null;
  correlationId?: string | null;
  source?: string | null;
  sourceVersion?: string | null;
  relatedTransitionId?: string | null;
  relatedReportId?: string | null;
  relatedAuditLogId?: string | null;
}

const MAX_METADATA_BYTES = 4096;
const MAX_EVIDENCE_BYTES = 8192;

function stripSecrets(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  const SECRET_KEYS_LOWER = new Set([
    'token', 'password', 'secret', 'jwt', 'authorization',
    'database_url', 'accesstoken', 'refreshtoken', 'apikey',
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_KEYS_LOWER.has(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result;
}

function truncateJson(
  value: Record<string, unknown> | null | undefined,
  maxBytes: number,
): Record<string, unknown> | null {
  if (!value) return null;
  const cleaned = stripSecrets(value);
  if (!cleaned) return null;
  const json = JSON.stringify(cleaned);
  if (Buffer.byteLength(json, 'utf-8') <= maxBytes) return cleaned;
  const entries = Object.entries(cleaned);
  const result: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    const candidate = { ...result, [k]: v };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf-8') <= maxBytes) {
      result[k] = v;
    }
  }
  return result;
}

export async function recordRequirementEvent(
  txOrPrisma: any,
  event: LedgerEventInput,
) {
  if (!event.requirementId) throw new Error('requirementId is required');
  if (!event.eventType) throw new Error('eventType is required');
  const actorType = event.actorType ?? 'system';
  const metadata = truncateJson(event.metadata ?? null, MAX_METADATA_BYTES);
  const evidence = truncateJson(event.evidence ?? null, MAX_EVIDENCE_BYTES);
  return (txOrPrisma as any).requirementEventLedger.create({
    data: {
      requirementId: event.requirementId,
      eventType: event.eventType,
      actorId: event.actorId ?? undefined,
      actorName: event.actorName ?? undefined,
      actorType,
      fromStatus: event.fromStatus ?? undefined,
      toStatus: event.toStatus ?? undefined,
      fromStep: event.fromStep ?? undefined,
      toStep: event.toStep ?? undefined,
      fromAssigneeId: event.fromAssigneeId ?? undefined,
      toAssigneeId: event.toAssigneeId ?? undefined,
      reasonCode: event.reasonCode ?? undefined,
      reasonText: event.reasonText ?? undefined,
      evidence: (evidence as any) ?? undefined,
      metadata: (metadata as any) ?? undefined,
      stateVersionBefore: event.stateVersionBefore ?? undefined,
      stateVersionAfter: event.stateVersionAfter ?? undefined,
      correlationId: event.correlationId ?? undefined,
      source: event.source ?? undefined,
      sourceVersion: event.sourceVersion ?? undefined,
      relatedTransitionId: event.relatedTransitionId ?? undefined,
      relatedReportId: event.relatedReportId ?? undefined,
      relatedAuditLogId: event.relatedAuditLogId ?? undefined,
    },
  });
}

export function buildWorkflowEvent(
  eventType: string,
  params: {
    requirementId: string;
    fromStep?: string | null;
    toStep?: string | null;
    fromAssigneeId?: string | null;
    toAssigneeId?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    actorType?: string;
    reasonCode?: string | null;
    reasonText?: string | null;
    relatedTransitionId?: string | null;
    stateVersionBefore?: number | null;
    stateVersionAfter?: number | null;
    metadata?: Record<string, unknown> | null;
  },
): LedgerEventInput {
  return {
    requirementId: params.requirementId,
    eventType,
    actorId: params.actorId,
    actorName: params.actorName,
    actorType: params.actorType ?? 'human',
    fromStep: params.fromStep,
    toStep: params.toStep,
    fromAssigneeId: params.fromAssigneeId,
    toAssigneeId: params.toAssigneeId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    reasonCode: params.reasonCode,
    reasonText: params.reasonText,
    relatedTransitionId: params.relatedTransitionId,
    stateVersionBefore: params.stateVersionBefore,
    stateVersionAfter: params.stateVersionAfter,
    metadata: params.metadata,
  };
}
