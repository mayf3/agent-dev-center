import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { notifyEvent } from '../../utils/notifications.js';
import { requireInternalRole } from '../../middleware/internal-workflow.js';

export function registerReviewRoutes(router: import('express').Router): void {

// POST /:id/pm-approve - PM 审批 P0/P1 需求
router.post(
  '/:id/pm-approve',
  requireInternalRole('pm'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const { approved, comment } = req.body as { approved: boolean; comment?: string };

    if (typeof approved !== 'boolean') {
      throw new HttpError(400, '缺少 approved 字段 (boolean)');
    }

    const existing = await prisma.requirement.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '需求不存在');

    if (existing.priority !== 'P0' && existing.priority !== 'P1') {
      throw new HttpError(400, '只有 P0/P1 需求需要 PM 审批');
    }

    if (existing.pmApprovedAt) {
      throw new HttpError(409, '该需求已经 PM 审批过');
    }

    if (!approved) {
      const updated = await prisma.requirement.update({
        where: { id },
        data: { currentStep: 'rejected', rejectReason: comment || 'PM 审批未通过' }
      });
      void notifyEvent('requirement.updated' as any, {
        id: updated.id, title: updated.title, pm: req.user!.name, comment: (comment || '') as string,
      } as any);
      return res.json({ requirement: updated, message: 'PM 审批未通过' });
    }

    const updated = await prisma.requirement.update({
      where: { id },
      data: { pmApprovedAt: new Date(), pmApprovedBy: req.user!.name }
    });

    void notifyEvent('requirement.updated' as any, {
      id: updated.id, title: updated.title, pm: req.user!.name, comment: (comment || '') as string,
    } as any);

    res.json({ requirement: updated, message: 'PM 审批通过' });
  })
);

}
