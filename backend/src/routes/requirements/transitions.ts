import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';

export function registerTransitionRoutes(router: Router): void {
  // GET /:id/transitions — 需求流转时间线
  router.get(
    '/:id/transitions',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      // 权限：admin/cto 可看所有，其他角色只能看自己参与的需求
      const isAdmin = req.user!.role === 'admin' || req.user!.internalRole === 'cto';
      if (!isAdmin) {
        const requirement = await prisma.requirement.findUnique({
          where: { id: params.id },
          select: { assigneeId: true, requesterId: true },
        });
        if (!requirement) throw new HttpError(404, '需求不存在');
        const isAssignee = requirement.assigneeId === req.user!.id;
        const isRequester = requirement.requesterId === req.user!.id;
        if (!isAssignee && !isRequester) {
          throw new HttpError(403, '无权查看该需求的流转历史');
        }
      }

      const transitions = await prisma.workflowTransition.findMany({
        where: { requirementId: params.id },
        orderBy: { createdAt: 'asc' },
      });

      res.json({
        success: true,
        data: transitions,
      });
    }),
  );
}
