import { Prisma } from '@prisma/client';
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { assignWorkflowSchema } from '../../schemas/workflow.js';
import { parseSteps, extractRoleUserMap, WorkflowStep } from './workflow-helpers.js';
import { resolveAssigneeForStep } from '../../lib/assignee-resolver.js';
import { executeAssignTransition } from '../../lib/workflow-transition/index.js';

export function registerWorkflowAssignRoutes(router: import('express').Router): void {

  router.post(
    '/:id/workflow/assign',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = assignWorkflowSchema.parse({ body: req.body });

      const requirement = await prisma.requirement.findUnique({ where: { id: params.id } });
      if (!requirement) throw new HttpError(404, 'requirement not found');

      const template = await prisma.workflowTemplate.findFirst({
        where: { name: body.workflowName, isActive: true },
      });
      if (!template) throw new HttpError(404, `workflow template「${body.workflowName}」not found or inactive`);

      const steps = parseSteps(template.steps);
      if (steps.length === 0) throw new HttpError(400, 'workflow template has no valid steps');

      const genericDevSteps = steps.filter(s => s.role === 'developer');
      if (genericDevSteps.length > 0) {
        throw new HttpError(400, `template uses deprecated generic role 'developer' (steps: ${genericDevSteps.map(s => s.name).join(', ')}), use specific role template`);
      }

      let targetStep: WorkflowStep | undefined;
      if (body.startStep) {
        targetStep = steps.find(s => s.name === body.startStep);
        if (!targetStep) {
          throw new HttpError(400, `step「${body.startStep}」not found, available: ${steps.map(s => s.name).join(', ')}`);
        }
      } else {
        targetStep = steps[0];
      }
      if (!targetStep) throw new HttpError(400, 'no target step resolved');

      let newAssigneeId: string | null;
      if (targetStep.name === 'draft' && requirement.requesterId) {
        newAssigneeId = requirement.requesterId;
      } else if (targetStep.role === 'requester' && requirement.requesterId) {
        newAssigneeId = requirement.requesterId;
      } else {
        const roleUserMap = extractRoleUserMap(template.steps);
        try {
          const resolvedId = await resolveAssigneeForStep(
            targetStep.role, requirement.assigneeId,
            {
              assigneeMode: targetStep.assigneeMode,
              roleUserMap,
              requirement: {
                id: requirement.id,
                requesterId: requirement.requesterId,
                assigneeId: requirement.assigneeId,
              },
            },
          );
          newAssigneeId = resolvedId;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new HttpError(400, `assignee resolution failed: ${msg}`);
        }
      }

      const result = await executeAssignTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: targetStep.name,
        toStepDisplayName: targetStep.displayName,
        expectedStateVersion: requirement.stateVersion,
        workflowId: template.id,
        workflowName: template.name,
        workflowDisplayName: template.displayName,
        workflowSnapshot: template.steps as Prisma.InputJsonValue,
        assigneeId: newAssigneeId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        startStep: body.startStep,
        steps: steps.map(s => ({
          name: s.name,
          displayName: s.displayName,
          role: s.role,
          requiredReports: s.requiredReports,
        })),
      });

      res.json({
        success: true,
        data: result,
      });
    }),
  );

}
