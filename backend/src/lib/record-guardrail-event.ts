/**
 * Best-effort guardrail blocked event recorder.
 *
 * Records a GUARDRAIL_BLOCKED ledger event asynchronously.
 * Never throws — failures are silently caught to avoid changing
 * the original guardrail error response.
 */
import { prisma } from './prisma.js';
import { recordRequirementEvent } from '../services/requirement-event-ledger-service.js';
import { RequirementEventType } from './requirement-event-types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recordGuardrailBlocked(params: {
  requirementId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  reasonCode: string;
  reasonText: string;
  fromStep?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
}): void {
  // Silently skip if requirementId is missing or not a valid UUID
  if (!params.requirementId || !UUID_RE.test(params.requirementId)) {
    return;
  }

  const actorType = params.actorId ? 'human' : 'system';

  void recordRequirementEvent(prisma, {
    requirementId: params.requirementId,
    eventType: RequirementEventType.GUARDRAIL_BLOCKED,
    actorId: params.actorId ?? undefined,
    actorName: params.actorName ?? undefined,
    actorType,
    reasonCode: params.reasonCode,
    reasonText: params.reasonText,
    fromStep: params.fromStep ?? undefined,
    source: params.source,
    metadata: params.metadata ?? undefined,
  }).catch(() => {
    // best-effort only; never affect original guardrail response
  });
}
