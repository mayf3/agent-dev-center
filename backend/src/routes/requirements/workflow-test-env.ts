/**
 * Workflow Test Env Lock Routes
 *
 * GET /workflow/test-env-lock           — view test env lock status
 * DELETE /workflow/test-env-lock        — force release lock (admin/cto only)
 * POST /workflow/test-env-lock/blocked  — report build failure, auto-reject to dev_self_check
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { releaseTestEnvLock } from './workflow-advance-helpers.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import { logTransition } from './workflow-helpers.js';

export function registerWorkflowTestEnvRoutes(router: import('express').Router): void {

  router.get(
    '/workflow/test-env-lock',
    asyncHandler(async (_req, res) => {
      const lock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
      const queueCount = await prisma.requirement.count({
        where: { currentStep: 'test_env_deploy' },
      });
      res.json({
        locked: !!lock,
        lock: lock ? {
          requirementId: lock.requirementId,
          requirementTitle: lock.requirementTitle,
          branch: lock.branch,
          acquiredAt: lock.acquiredAt,
        } : null,
        queueLength: queueCount,
      });
    }),
  );

  router.delete(
    '/workflow/test-env-lock',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const lock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
      if (!lock) {
        res.json({ success: true, message: 'lock does not exist, nothing to release' });
        return;
      }
      await prisma.testEnvLock.delete({ where: { id: 'singleton' } });
      console.log(`[test-env-lock] admin ${req.user?.name} force released lock (prev holder: ${lock.requirementId?.slice(0, 8)} ${lock.requirementTitle?.slice(0, 30)})`);
      res.json({
        success: true,
        message: 'test env lock force released',
        releasedFrom: {
          requirementId: lock.requirementId,
          requirementTitle: lock.requirementTitle,
          acquiredAt: lock.acquiredAt,
        },
      });
    }),
  );

  // POST /workflow/test-env-lock/blocked — report build failure, auto-reject to dev_self_check
  router.post(
    '/workflow/test-env-lock/blocked',
    asyncHandler(async (req, res) => {
      // Only the deployer or admin can report build failure
      const lock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
      if (!lock) throw new HttpError(400, '当前无活跃测试环境锁');

      const requirement = await prisma.requirement.findUnique({
        where: { id: lock.requirementId },
        include: { workflow: { select: { steps: true } } },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (requirement.currentStep !== 'test_env_deploy') throw new HttpError(400, '需求当前步骤不是 test_env_deploy');

      // Find dev_self_check step
      const steps = (requirement.workflow?.steps as any[]) ?? [];
      const devStep = steps.find((s: any) => s.name === 'dev_self_check');
      if (!devStep) throw new HttpError(400, '工作流中缺少 dev_self_check 步骤');

      // Resolve assignee
      let newAssigneeId: string | null = null;
      try {
        newAssigneeId = await resolveAssigneeForStep(devStep.role, requirement.assigneeId, {
          assigneeMode: devStep.assigneeMode ?? 'role-based',
          roleUserMap: null,
          requirement: { id: requirement.id, requesterId: requirement.requesterId, assigneeId: requirement.assigneeId },
        });
      } catch {
        newAssigneeId = requirement.assigneeId;
      }

      // Reject to dev_self_check
      await prisma.requirement.update({
        where: { id: requirement.id },
        data: { currentStep: 'dev_self_check', assigneeId: newAssigneeId },
      });

      // Release test env lock
      await releaseTestEnvLock(requirement.id);

      // Log transition
      const actorName = req.user?.name ?? 'system';
      await logTransition({
        requirementId: requirement.id,
        fromStep: 'test_env_deploy',
        toStep: 'dev_self_check',
        action: 'reject',
        actorId: req.user?.id ?? '00000000-0000-0000-0000-000000000000',
        actorName,
        actorRole: req.user?.internalRole ?? req.user?.role ?? 'system',
        comment: '构建失败，自动驳回至 dev_self_check',
      });

      res.json({
        success: true,
        data: { fromStep: 'test_env_deploy', toStep: 'dev_self_check', newAssigneeId, newAssigneeName: await getAssigneeName(newAssigneeId) },
      });
    }),
  );

}
