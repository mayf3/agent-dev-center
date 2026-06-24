/**
 * Workflow Test Env Lock Routes
 *
 * GET /workflow/test-env-lock    — view test env lock status
 * DELETE /workflow/test-env-lock — force release lock (admin/cto only)
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';

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

}
