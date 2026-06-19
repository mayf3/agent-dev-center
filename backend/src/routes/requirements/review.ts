import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { notifyEvent } from '../../utils/notifications.js';
import { requireInternalRole } from '../../middleware/internal-workflow.js';
import { executeAdminTransition } from '../../lib/workflow-transition/index.js';

export function registerReviewRoutes(router: import('express').Router): void {

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
      const result = await executeAdminTransition({
        requirementId: id,
        fromStep: existing.currentStep,
        toStep: 'rejected',
        expectedStateVersion: existing.stateVersion,
        action: 'pm-reject',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role,
        assigneeId: existing.assigneeId,
        rejectReason: comment || 'PM 审批未通过',
        comment: comment,
      });

      void notifyEvent('requirement.updated', {
        id: result.requirementId,
        title: existing.title,
        actor: req.user!.name,
        pm: req.user!.name,
        comment: comment || '',
      });
      return res.json({ requirement: { ...existing, currentStep: 'rejected', stateVersion: result.newStateVersion }, message: 'PM 审批未通过' });
    }

    const updated = await prisma.requirement.update({
      where: { id },
      data: { pmApprovedAt: new Date(), pmApprovedBy: req.user!.name }
    });

    void notifyEvent('requirement.updated', {
      id: updated.id,
      title: updated.title,
      actor: req.user!.name,
      pm: req.user!.name,
      comment: comment || '',
    });

    res.json({ requirement: updated, message: 'PM 审批通过' });
  })
);

}
