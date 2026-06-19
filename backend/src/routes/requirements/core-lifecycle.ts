import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { listRevisionsSchema } from '../../schemas/revision.js';
import { serializeRequirement } from '../../utils/status.js';
import { notifyEvent } from '../../utils/notifications.js';
import { canReadRequirement } from './utils.js';
import { executeAdminTransition } from '../../lib/workflow-transition/index.js';

const lifecycleInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
} as const;

export function registerCoreLifecycleRoutes(router: import('express').Router): void {

router.get(
  '/:id/revisions',
  asyncHandler(async (req, res) => {
    const { params, query } = listRevisionsSchema.parse({ params: req.params, query: req.query });
    const requirement = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, '无权查看');

    const skip = (query.page - 1) * query.pageSize;
    const [revisions, total] = await prisma.$transaction([
      prisma.requirementRevision.findMany({
        where: { requirementId: params.id },
        orderBy: { createdAt: 'desc' },
        skip, take: query.pageSize,
        include: { operator: { select: { id: true, name: true } } },
      }),
      prisma.requirementRevision.count({ where: { requirementId: params.id } }),
    ]);

    res.json({
      data: revisions,
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  })
);

router.post(
  '/:id/abandon',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, '请先登录');
    const { params } = requirementIdSchema.parse({ params: req.params });
    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '需求不存在');
    if (!['rejected', 'review_rejected', 'acceptance_rejected'].includes(existing.currentStep ?? '')) {
      throw new HttpError(400, `只能放弃被驳回的需求，当前步骤：${existing.currentStep}`);
    }
    if (existing.requesterId !== req.user.id && req.user.role !== 'admin') {
      throw new HttpError(403, '只有需求提交者或管理员可以放弃需求');
    }

    const result = await executeAdminTransition({
      requirementId: params.id,
      fromStep: existing.currentStep,
      toStep: 'abandoned',
      expectedStateVersion: existing.stateVersion,
      action: 'abandon',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.internalRole ?? req.user.role,
      assigneeId: existing.assigneeId,
    });

    const updated = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: lifecycleInclude,
    });
    if (!updated) throw new HttpError(404, '需求已删除');
    void notifyEvent('requirement.updated', { id: updated.id, title: updated.title, actor: req.user.name });
    res.json(serializeRequirement(updated));
  })
);

router.post(
  '/:id/reactivate',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, '请先登录');
    const { params } = requirementIdSchema.parse({ params: req.params });
    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '需求不存在');
    if (existing.currentStep !== 'abandoned') {
      throw new HttpError(400, `只能重新激活已放弃的需求，当前步骤：${existing.currentStep}`);
    }
    if (existing.requesterId !== req.user.id && req.user.role !== 'admin') {
      throw new HttpError(403, '只有需求提交者或管理员可以重新激活需求');
    }

    const result = await executeAdminTransition({
      requirementId: params.id,
      fromStep: 'abandoned',
      toStep: 'draft',
      expectedStateVersion: existing.stateVersion,
      action: 'reactivate',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.internalRole ?? req.user.role,
      assigneeId: null,
    });

    const updated = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: lifecycleInclude,
    });
    if (!updated) throw new HttpError(404, '需求已删除');
    void notifyEvent('requirement.updated', { id: updated.id, title: updated.title, actor: req.user.name });
    res.json(serializeRequirement(updated));
  })
);

}
