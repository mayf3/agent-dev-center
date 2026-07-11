/**
 * Best-effort guardrail blocked event recorder.
 *
 * Records a GUARDRAIL_BLOCKED ledger event synchronously (awaited).
 * Never throws — failures are caught, logged, and do NOT change
 * the original guardrail error response.
 */
import { prisma } from './prisma.js';
import { recordRequirementEvent } from '../services/requirement-event-ledger-service.js';
import { RequirementEventType } from './requirement-event-types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordGuardrailBlocked(params: {
  requirementId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  reasonCode: string;
  reasonText: string;
  fromStep?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // Silently skip if requirementId is missing or not a valid UUID
  if (!params.requirementId || !UUID_RE.test(params.requirementId)) {
    return;
  }

  const actorType = params.actorId ? 'human' : 'system';

  try {
    await recordRequirementEvent(prisma, {
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
    });
  } catch (err) {
    // Best-effort only; never affect original guardrail response.
    // Structured error log without sensitive data.
    const safe = {
      event: 'GUARDRAIL_BLOCKED_LEDGER_FAILED',
      requirementId: params.requirementId,
      reasonCode: params.reasonCode,
      source: params.source,
      error: err instanceof Error ? err.message : String(err),
    };
    console.error(JSON.stringify(safe));
  }
}
