import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { executeAdminTransition } from '../../lib/workflow-transition/index.js';

export function registerWorkflowLifecycleRoutes(router: import('express').Router): void {

  router.post(
    '/:id/workflow/abandon',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: { id: true, currentStep: true, stateVersion: true, requesterId: true, assigneeId: true },
      });
      if (!requirement) throw new HttpError(404, 'requirement not found');

      const user = req.user!;
      const isOwner = requirement.requesterId === user.id;
      const isAssignee = requirement.assigneeId === user.id;
      const isAdmin = user.role === 'admin' || user.role === 'cto_agent';
      if (!isOwner && !isAssignee && !isAdmin) {
        throw new HttpError(403, 'only requester, assignee or admin can abandon');
      }

      const abandonableSteps = ['rejected', 'draft', 'pm_review', 'dev_self_check', 'qa_review', 'testing'];
      if (!abandonableSteps.includes(requirement.currentStep ?? '')) {
        throw new HttpError(400, `current step「${requirement.currentStep}」cannot be abandoned, allowed: ${abandonableSteps.join('/')}`);
      }

      const result = await executeAdminTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: 'abandoned',
        expectedStateVersion: requirement.stateVersion,
        action: 'abandon',
        actorId: user.id,
        actorName: user.name,
        actorRole: user.internalRole ?? user.role,
        assigneeId: null,
        comment: req.body?.comment,
      });

      res.json({
        success: true,
        data: {
          requirementId: result.requirementId,
          fromStep: requirement.currentStep,
          toStep: 'abandoned',
          newStateVersion: result.newStateVersion,
        },
      });
    }),
  );

  router.post(
    '/:id/workflow/to-draft',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: { id: true, currentStep: true, stateVersion: true, requesterId: true, assigneeId: true },
      });
      if (!requirement) throw new HttpError(404, 'requirement not found');
      if (requirement.currentStep !== 'abandoned') {
        throw new HttpError(400, 'only abandoned requirements can be reactivated to draft');
      }

      const user = req.user!;
      const isOwner = requirement.requesterId === user.id;
      const isAssignee = requirement.assigneeId === user.id;
      const isAdmin = user.role === 'admin' || user.role === 'cto_agent';
      if (!isOwner && !isAssignee && !isAdmin) {
        throw new HttpError(403, 'only requester, assignee or admin can reactivate');
      }

      const result = await executeAdminTransition({
        requirementId: params.id,
        fromStep: 'abandoned',
        toStep: 'draft',
        expectedStateVersion: requirement.stateVersion,
        action: 'reactivate',
        actorId: user.id,
        actorName: user.name,
        actorRole: user.internalRole ?? user.role,
        assigneeId: null,
        comment: req.body?.comment,
      });

      res.json({
        success: true,
        data: {
          requirementId: result.requirementId,
          fromStep: 'abandoned',
          toStep: 'draft',
          newStateVersion: result.newStateVersion,
        },
      });
    }),
  );

}
