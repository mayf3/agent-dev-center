/**
 * Execution Lease API
 *
 * POST   /:id/lease/claim     — claim an execution lease for a requirement step
 * POST   /:id/lease/heartbeat — heartbeat to keep lease alive
 * POST   /:id/lease/release   — release a lease early
 * GET    /:id/lease           — view current lease for a requirement
 *
 * Leases provide exclusive execution rights for a specific workflow step,
 * preventing concurrent operations on the same requirement.
 */

import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { z } from 'zod';

const LEASE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const claimLeaseSchema = z.object({
  body: z.object({
    workflowStep: z.string().min(1),
    expectedStateVersion: z.number().int().nonnegative(),
    claimKey: z.string().min(1).max(255),
    agentId: z.string().optional(),
    worktreePath: z.string().optional(),
    gitBranch: z.string().optional(),
  }),
});

const heartbeatLeaseSchema = z.object({
  body: z.object({
    claimKey: z.string().min(1),
  }),
});

export function registerExecutionLeaseRoutes(router: Router) {
  // Claim lease
  router.post(
    '/:id/lease/claim',
    authRequired,
    asyncHandler(async (req, res) => {
      const { body } = claimLeaseSchema.parse({ body: req.body });
      const requirementId = req.params.id as string;

      const requirement = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: { id: true, currentStep: true, stateVersion: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');

      // Check for existing active lease
      const existing = await prisma.executionLease.findFirst({
        where: { requirementId, status: 'ACTIVE' },
      });
      if (existing) {
        throw new HttpError(409, `已有活跃执行租约（session: ${existing.sessionId.slice(0, 8)}），请先释放或等待过期`);
      }

      const lease = await prisma.executionLease.create({
        data: {
          requirementId,
          workflowStep: body.workflowStep,
          expectedStateVersion: body.expectedStateVersion,
          ownerUserId: req.user!.id,
          ownerAgentId: body.agentId ?? null,
          sessionId: `ses-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          claimKey: body.claimKey,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + LEASE_TTL_MS),
          worktreePath: body.worktreePath ?? null,
          gitBranch: body.gitBranch ?? null,
        },
      });

      res.status(201).json({ success: true, data: lease });
    }),
  );

  // Heartbeat — extend TTL
  router.post(
    '/:id/lease/heartbeat',
    authRequired,
    asyncHandler(async (req, res) => {
      const { body } = heartbeatLeaseSchema.parse({ body: req.body });
      const requirementId = req.params.id as string;

      const lease = await prisma.executionLease.findFirst({
        where: { requirementId, claimKey: body.claimKey, status: 'ACTIVE' },
      });
      if (!lease) throw new HttpError(404, '未找到活跃租约');

      if (new Date() > lease.expiresAt) {
        await prisma.executionLease.update({
          where: { id: lease.id },
          data: { status: 'EXPIRED' },
        });
        throw new HttpError(410, '租约已过期');
      }

      const updated = await prisma.executionLease.update({
        where: { id: lease.id },
        data: { expiresAt: new Date(Date.now() + LEASE_TTL_MS), heartbeatAt: new Date() },
      });

      res.json({ success: true, data: updated });
    }),
  );

  // Release lease early
  router.post(
    '/:id/lease/release',
    authRequired,
    asyncHandler(async (req, res) => {
      const { body } = heartbeatLeaseSchema.parse({ body: req.body });
      const requirementId = req.params.id as string;

      const lease = await prisma.executionLease.findFirst({
        where: { requirementId, claimKey: body.claimKey, status: 'ACTIVE' },
      });
      if (!lease) throw new HttpError(404, '未找到活跃租约');

      const updated = await prisma.executionLease.update({
        where: { id: lease.id },
        data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: 'explicit_release' },
      });

      res.json({ success: true, data: updated });
    }),
  );

  // View current lease
  router.get(
    '/:id/lease',
    authRequired,
    asyncHandler(async (req, res) => {
      const requirementId = req.params.id as string;
      const lease = await prisma.executionLease.findFirst({
        where: { requirementId, status: 'ACTIVE' },
      });
      res.json({ data: lease ?? null });
    }),
  );
}
