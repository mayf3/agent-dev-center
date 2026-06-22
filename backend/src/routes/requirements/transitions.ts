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

  // GET /mine/transitions — 查询当前用户参与过的所有需求流转记录
  router.get(
    '/mine/transitions',
    asyncHandler(async (req, res) => {
      const userId = req.user!.id;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
      const skip = (page - 1) * pageSize;

      const where = { actorId: userId };

      const [transitions, total] = await prisma.$transaction([
        prisma.workflowTransition.findMany({
          where,
          include: {
            requirement: {
              select: { id: true, title: true, currentStep: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        prisma.workflowTransition.count({ where }),
      ]);

      res.json({
        data: transitions.map(t => ({
          id: t.id,
          requirementId: t.requirementId,
          requirementTitle: t.requirement.title,
          fromStep: t.fromStep,
          toStep: t.toStep,
          action: t.action,
          actorName: t.actorName,
          actorRole: t.actorRole,
          comment: t.comment,
          createdAt: t.createdAt,
        })),
        total,
        page,
        pageSize,
      });
    }),
  );
}
