/**
 * Root Cause Candidate Aggregator v0
 *
 * Aggregates RequirementEventLedger GUARDRAIL_BLOCKED events into
 * RootCauseCandidate records for identifying systemic problems.
 *
 * Pure functions for testability; prisma-dependent functions accept a client.
 */
import { createHash } from 'node:crypto';

// ── Types ────────────────────────────────────────────

export const ALLOWED_REASON_CODES = new Set([
  'DEV_SELF_CHECK_REPORT_MISSING',
  'REPORT_NOT_APPROVED',
  'DEPLOY_FIELD_MISSING',
  'WIP_OVERLOAD',
  'ROLE_MISMATCH',
  'STATE_CONFLICT',
  'TEST_ENV_LOCKED',
]);

export const ROOT_CAUSE_TYPE_MAP: Record<string, string> = {
  DEV_SELF_CHECK_REPORT_MISSING: 'MISSING_REQUIRED_OUTPUT',
  REPORT_NOT_APPROVED: 'REPORT_GATE_BLOCKED',
  DEPLOY_FIELD_MISSING: 'MISSING_DEPLOYMENT_METADATA',
  WIP_OVERLOAD: 'CAPACITY_BOTTLENECK',
  ROLE_MISMATCH: 'ROUTING_OR_ROLE_MISMATCH',
  STATE_CONFLICT: 'CONCURRENCY_CONFLICT',
  TEST_ENV_LOCKED: 'INFRA_LOCK_CONTENTION',
};

export const ROOT_CAUSE_TITLES: Record<string, string> = {
  MISSING_REQUIRED_OUTPUT: '开发自检报告缺失',
  REPORT_GATE_BLOCKED: '报告未提交或未审批导致流程阻塞',
  MISSING_DEPLOYMENT_METADATA: '部署必要字段缺失',
  CAPACITY_BOTTLENECK: 'WIP 超载导致流程阻塞',
  ROUTING_OR_ROLE_MISMATCH: '角色或路由不匹配',
  CONCURRENCY_CONFLICT: '并发冲突导致 CAS 更新失败',
  INFRA_LOCK_CONTENTION: '测试环境锁定冲突',
};

export interface LedgerEventRow {
  id: string;
  requirementId: string;
  eventType: string;
  reasonCode: string | null;
  reasonText: string | null;
  fromStep: string | null;
  toStep: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  requirement?: {
    workflowId: string | null;
    workflow?: { name: string | null } | null;
  } | null;
}

export interface CandidateGroup {
  fingerprint: string;
  reasonCode: string;
  rootCauseType: string;
  title: string;
  workflowId: string | null;
  workflowName: string | null;
  events: LedgerEventRow[];
}

export interface CandidateUpsert {
  fingerprint: string;
  workflowId: string | null;
  workflowName: string | null;
  rootCauseType: string;
  title: string;
  description: string | null;
  severity: string;
  reasonCode: string;
  eventType: string;
  affectedRequirementCount: number;
  sampleRequirementIds: string[];
  evidenceEventIds: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  metadata: Record<string, unknown>;
}

// ── Fingerprint ──────────────────────────────────────

export function buildFingerprint(params: {
  reasonCode: string;
  eventType: string;
  fromStep: string | null;
  toStep: string | null;
  workflowId: string | null;
  reportType?: string | null;
  missingReportTypes?: string[] | null;
}): string {
  const stableParts = [
    params.reasonCode,
    params.eventType,
    params.fromStep ?? '',
    params.toStep ?? '',
    params.workflowId ?? '',
    params.reportType ?? '',
    params.missingReportTypes?.sort().join(',') ?? '',
  ];
  const input = stableParts.join('|');
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

// ── Severity ─────────────────────────────────────────

export function computeSeverity(affectedCount: number, reasonCode: string): string {
  const minMedium = new Set(['STATE_CONFLICT', 'TEST_ENV_LOCKED']);
  if (affectedCount >= 10) return 'high';
  if (affectedCount >= 3) return 'medium';
  if (minMedium.has(reasonCode) && affectedCount >= 1) return 'medium';
  return 'low';
}

// ── Group events ─────────────────────────────────────

export function groupEvents(events: LedgerEventRow[]): Map<string, CandidateGroup> {
  const groups = new Map<string, CandidateGroup>();

  for (const ev of events) {
    if (!ev.reasonCode || !ALLOWED_REASON_CODES.has(ev.reasonCode)) continue;

    const rootCauseType = ROOT_CAUSE_TYPE_MAP[ev.reasonCode];
    const title = ROOT_CAUSE_TITLES[rootCauseType] ?? ev.reasonCode;
    const workflowId = ev.requirement?.workflowId ?? null;
    const workflowName = ev.requirement?.workflow?.name ?? null;

    const meta = ev.metadata ?? {};
    const fingerprint = buildFingerprint({
      reasonCode: ev.reasonCode,
      eventType: ev.eventType,
      fromStep: ev.fromStep,
      toStep: ev.toStep,
      workflowId,
      reportType: (meta.reportType as string) ?? null,
      missingReportTypes: (meta.missingReportTypes as string[]) ?? null,
    });

    const existing = groups.get(fingerprint);
    if (existing) {
      existing.events.push(ev);
    } else {
      groups.set(fingerprint, {
        fingerprint,
        reasonCode: ev.reasonCode,
        rootCauseType,
        title,
        workflowId,
        workflowName,
        events: [ev],
      });
    }
  }

  return groups;
}

// ── Build upsert payload ─────────────────────────────

export function buildCandidateUpsert(group: CandidateGroup, windowHours: number): CandidateUpsert {
  const eventCount = group.events.length;
  const uniqueReqIds = [...new Set(group.events.map(e => e.requirementId))];
  const severity = computeSeverity(uniqueReqIds.length, group.reasonCode);

  const sources = [...new Set(
    group.events.map(e => (e.metadata as Record<string, string>)?.source ?? 'unknown').filter(Boolean),
  )];

  const eventIds = group.events.map(e => e.id).slice(0, 20);
  const sampleReqIds = uniqueReqIds.slice(0, 10);

  const descriptions = group.events.map(e => e.reasonText).filter(Boolean) as string[];
  const description = descriptions.length > 0
    ? [...new Set(descriptions)].slice(0, 3).join('; ')
    : null;

  return {
    fingerprint: group.fingerprint,
    workflowId: group.workflowId,
    workflowName: group.workflowName,
    rootCauseType: group.rootCauseType,
    title: group.title,
    description,
    severity,
    reasonCode: group.reasonCode,
    eventType: 'GUARDRAIL_BLOCKED',
    affectedRequirementCount: uniqueReqIds.length,
    sampleRequirementIds: sampleReqIds,
    evidenceEventIds: eventIds,
    firstSeenAt: group.events[0].createdAt,
    lastSeenAt: group.events[group.events.length - 1].createdAt,
    metadata: {
      windowHours,
      reasonCode: group.reasonCode,
      eventCount,
      affectedRequirementCount: uniqueReqIds.length,
      sources,
    },
  };
}

// ── Skip resolved/ignored ────────────────────────────

const SKIP_STATUSES = new Set(['resolved', 'ignored']);

export function shouldSkipExisting(status: string | null | undefined): boolean {
  return !!status && SKIP_STATUSES.has(status);
}
