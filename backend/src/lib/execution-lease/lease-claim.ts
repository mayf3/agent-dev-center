import { PrismaClient, Prisma } from '@prisma/client';
import { HttpError } from '../../utils/http-error.js';
import { LEASE_INCLUDE, LeaseWithDetails, EVENT_TYPE, TERMINAL_STEPS, ClaimBody, SYSTEM_KEY_PREFIX } from './lease-constants.js';
import { lazyExpireActiveLeases } from './lease-lazy-expire.js';

export interface ClaimResult {
  lease: LeaseWithDetails;
  replayed: boolean;
}

export async function claimExecutionLease(
  prisma: PrismaClient,
  requirementId: string,
  ownerUserId: string,
  ownerAgentId: string | null | undefined,
  body: ClaimBody,
): Promise<ClaimResult> {
  if (body.idempotencyKey.startsWith(SYSTEM_KEY_PREFIX)) {
    throw new HttpError(400, 'idempotencyKey cannot start with system:');
  }

  const existingEvent = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
    include: { lease: { include: LEASE_INCLUDE } },
  });
  if (existingEvent) {
    return validateAndReplayClaim(existingEvent, requirementId, ownerUserId, ownerAgentId, body);
  }

  let lease: LeaseWithDetails;

  try {
    lease = await prisma.$transaction(async (tx) => {
      const txNow = new Date();
      const requirement = await (tx as any).requirement.findUnique({
        where: { id: requirementId },
        select: { id: true, currentStep: true, stateVersion: true, assigneeId: true },
      });
      if (!requirement) {
        throw new HttpError(404, 'requirement not found');
      }
      if (requirement.currentStep && TERMINAL_STEPS.has(requirement.currentStep)) {
        throw new HttpError(409, `requirement is in terminal state: ${requirement.currentStep}`);
      }
      if (requirement.currentStep !== body.expectedStep) {
        throw new HttpError(409, `expected step ${body.expectedStep} but current step is ${requirement.currentStep}`);
      }
      if (requirement.stateVersion !== body.expectedStateVersion) {
        throw new HttpError(409, `expected stateVersion ${body.expectedStateVersion} but current is ${requirement.stateVersion}`);
      }
      if (requirement.assigneeId !== ownerUserId) {
        throw new HttpError(403, 'only the current assignee can claim an execution lease');
      }

      await lazyExpireActiveLeases(requirementId, tx as any, ownerUserId);

      const activeLease = await (tx as any).executionLease.findFirst({
        where: { requirementId, status: 'ACTIVE', expiresAt: { gt: txNow } },
        select: { id: true, expiresAt: true },
      });
      if (activeLease) {
        throw new HttpError(409, 'an active lease already exists for this requirement and has not expired');
      }

      const expiresAt = new Date(txNow.getTime() + body.ttlSeconds * 1000);
      const created = await (tx as any).executionLease.create({
        data: {
          requirementId,
          workflowStep: body.expectedStep,
          expectedStateVersion: body.expectedStateVersion,
          ownerUserId,
          ownerAgentId: ownerAgentId ?? null,
          sessionId: body.sessionId,
          claimKey: body.idempotencyKey,
          status: 'ACTIVE',
          expiresAt,
        },
        include: LEASE_INCLUDE,
      });

      await (tx as any).executionLeaseEvent.create({
        data: {
          leaseId: created.id,
          eventType: EVENT_TYPE.CLAIMED,
          idempotencyKey: body.idempotencyKey,
          actorId: ownerUserId,
          metadata: {
            expectedStep: body.expectedStep,
            expectedStateVersion: body.expectedStateVersion,
            ttl: body.ttlSeconds,
            sessionId: body.sessionId,
            ownerAgentId: ownerAgentId ?? null,
          },
        },
      });

      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        const replayed = await tryReplayClaim(prisma, body.idempotencyKey, requirementId, ownerUserId, ownerAgentId, body);
        if (replayed) return replayed;
        throw new HttpError(409, 'concurrent claim conflict');
      }
      if (err.code === 'P2034') {
        throw new HttpError(409, 'serialization conflict, please retry');
      }
    }
    if (err instanceof HttpError) throw err;
    throw err;
  }

  return { lease: lease as LeaseWithDetails, replayed: false };
}

async function tryReplayClaim(
  prisma: PrismaClient,
  idempotencyKey: string,
  requirementId: string,
  ownerUserId: string,
  ownerAgentId: string | null | undefined,
  body: ClaimBody,
): Promise<ClaimResult | null> {
  const event = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey },
    include: { lease: { include: LEASE_INCLUDE } },
  });
  if (!event) return null;
  return validateAndReplayClaim(event, requirementId, ownerUserId, ownerAgentId, body);
}

function validateAndReplayClaim(
  existingEvent: any,
  requirementId: string,
  ownerUserId: string,
  ownerAgentId: string | null | undefined,
  body: ClaimBody,
): ClaimResult {
  const lease = existingEvent.lease;
  const meta = existingEvent.metadata ?? {};
  if (existingEvent.eventType !== EVENT_TYPE.CLAIMED) {
    throw new HttpError(409, 'idempotencyKey already used for a different operation');
  }
  if (lease.requirementId !== requirementId) {
    throw new HttpError(409, 'idempotencyKey already used for a different requirement');
  }
  if (lease.ownerUserId !== ownerUserId) {
    throw new HttpError(409, 'idempotencyKey already used for a different actor');
  }
  if ((lease.ownerAgentId ?? null) !== (ownerAgentId ?? null)) {
    throw new HttpError(409, 'idempotencyKey already used with different ownerAgentId');
  }
  if (lease.sessionId !== body.sessionId) {
    throw new HttpError(409, 'idempotencyKey already used for a different session');
  }
  if (meta.expectedStep !== body.expectedStep) {
    throw new HttpError(409, 'idempotencyKey already used with different expectedStep');
  }
  if (meta.expectedStateVersion !== body.expectedStateVersion) {
    throw new HttpError(409, 'idempotencyKey already used with different expectedStateVersion');
  }
  if (meta.ttl !== body.ttlSeconds) {
    throw new HttpError(409, 'idempotencyKey already used with different ttl');
  }
  return { lease: lease as LeaseWithDetails, replayed: true };
}
