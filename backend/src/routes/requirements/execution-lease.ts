import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import {
  claimLeaseSchema,
  renewLeaseSchema,
  updateWorktreeSchema,
  releaseLeaseSchema,
  leaseIdParamsSchema,
} from '../../schemas/execution-lease.js';
import {
  claimExecutionLease,
  renewExecutionLease,
  updateLeaseWorktree,
  releaseExecutionLease,
  getExecutionLease,
} from '../../lib/execution-lease/index.js';
import { canReadRequirement } from './utils.js';
import { prisma } from '../../lib/prisma.js';

export function registerExecutionLeaseRoutes(router: import('express').Router): void {

  router.post(
    '/:id/execution/claim',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = claimLeaseSchema.parse({ body: req.body });

      const result = await claimExecutionLease(params.id, req.user!.id, req.user!.agentId, {
        idempotencyKey: body.idempotencyKey,
        expectedStep: body.expectedStep,
        expectedStateVersion: body.expectedStateVersion,
        sessionId: body.sessionId,
        ttlSeconds: body.ttlSeconds,
      });

      res.status(result.replayed ? 200 : 201).json({
        success: true,
        data: {
          leaseId: result.lease.id,
          status: result.lease.status,
          acquiredAt: result.lease.acquiredAt,
          expiresAt: result.lease.expiresAt,
          workflowStep: result.lease.workflowStep,
          expectedStateVersion: result.lease.expectedStateVersion,
          ownerUserId: result.lease.ownerUserId,
          ownerAgentId: result.lease.ownerAgentId,
          sessionId: result.lease.sessionId,
          replayed: result.replayed,
        },
      });
    }),
  );

  router.post(
    '/:id/execution/leases/:leaseId/renew',
    asyncHandler(async (req, res) => {
      const { params } = leaseIdParamsSchema.parse({ params: req.params });
      const { body } = renewLeaseSchema.parse({ body: req.body });

      const result = await renewExecutionLease(params.id, params.leaseId, req.user!.id, req.user!.agentId, {
        idempotencyKey: body.idempotencyKey,
        sessionId: body.sessionId,
        ttlSeconds: body.ttlSeconds,
      });

      res.json({
        success: true,
        data: {
          leaseId: result.lease.id,
          status: result.lease.status,
          expiresAt: result.lease.expiresAt,
          replayed: result.replayed,
        },
      });
    }),
  );

  router.patch(
    '/:id/execution/leases/:leaseId/worktree',
    asyncHandler(async (req, res) => {
      const { params } = leaseIdParamsSchema.parse({ params: req.params });
      const { body } = updateWorktreeSchema.parse({ body: req.body });

      const lease = await updateLeaseWorktree(params.id, params.leaseId, req.user!.id, req.user!.agentId, {
        idempotencyKey: body.idempotencyKey,
        sessionId: body.sessionId,
        worktreePath: body.worktreePath,
        gitBranch: body.gitBranch,
      });

      res.json({
        success: true,
        data: {
          leaseId: lease.id,
          worktreePath: lease.worktreePath,
          gitBranch: lease.gitBranch,
        },
      });
    }),
  );

  router.post(
    '/:id/execution/leases/:leaseId/release',
    asyncHandler(async (req, res) => {
      const { params } = leaseIdParamsSchema.parse({ params: req.params });
      const { body } = releaseLeaseSchema.parse({ body: req.body });

      const lease = await releaseExecutionLease(params.id, params.leaseId, req.user!.id, req.user!.agentId, {
        idempotencyKey: body.idempotencyKey,
        sessionId: body.sessionId,
        outcome: body.outcome,
        reason: body.reason,
      });

      res.json({
        success: true,
        data: {
          leaseId: lease.id,
          status: lease.status,
          releasedAt: lease.releasedAt,
          releaseReason: lease.releaseReason,
        },
      });
    }),
  );

  router.get(
    '/:id/execution/lease',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: { id: true, requesterId: true, requester: true, assigneeId: true, assignee: true },
      });
      if (!requirement) throw new HttpError(404, 'requirement not found');
      if (!canReadRequirement(req.user!, requirement)) {
        throw new HttpError(403, 'no permission to read this requirement');
      }

      const result = await getExecutionLease(params.id);

      res.json({
        success: true,
        data: result,
      });
    }),
  );
}
