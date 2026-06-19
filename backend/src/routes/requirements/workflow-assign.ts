/**
 * Workflow Assign Route
 *
 * POST /:id/workflow/assign — assign workflow (admin/cto only)
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { assignWorkflowSchema } from '../../schemas/workflow.js';
import { parseSteps, logTransition, extractRoleUserMap } from './workflow-helpers.js';
import { resolveAssigneeForStep } from '../../lib/assignee-resolver.js';

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

      let targetStep;
      if (body.startStep) {
        targetStep = steps.find(s => s.name === body.startStep);
        if (!targetStep) {
          throw new HttpError(400, `step「${body.startStep}」not found, available: ${steps.map(s => s.name).join(', ')}`);
        }
      } else {
        targetStep = steps[0];
      }

      // Deep copy template steps as immutable snapshot, preserving roleUserMap
      const workflowSnapshot = JSON.parse(JSON.stringify(template.steps));

      const updateData: any = {
        workflowId: template.id,
        workflowSnapshot,
        currentStep: targetStep.name,
      };

      if (targetStep.name === 'draft' && requirement.requesterId) {
        updateData.assigneeId = requirement.requesterId;
      } else if (targetStep.role === 'requester' && requirement.requesterId) {
        updateData.assigneeId = requirement.requesterId;
      } else {
        const roleUserMap = extractRoleUserMap(template.steps);
        try {
          const resolvedId = await resolveAssigneeForStep(
            targetStep.role,
            requirement.assigneeId,
            {
              assigneeMode: (targetStep as any).assigneeMode,
              roleUserMap,
              requirement: {
                id: requirement.id,
                requesterId: requirement.requesterId,
                assigneeId: requirement.assigneeId,
              },
            },
          );
          updateData.assigneeId = resolvedId;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new HttpError(400, `assignee resolution failed: ${msg}`);
        }
      }

      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: updateData,
      });

      await logTransition({
        requirementId: params.id,
        fromStep: 'approved',
        toStep: targetStep.name,
        action: 'assign-workflow',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        metadata: { workflowName: template.name, templateId: template.id, startStep: body.startStep },
      });

      res.json({
        success: true,
        data: {
          requirementId: updated.id,
          workflowId: template.id,
          workflowName: template.name,
          workflowDisplayName: template.displayName,
          currentStep: targetStep.name,
          currentStepDisplayName: targetStep.displayName,
          steps: steps.map(s => ({
            name: s.name,
            displayName: s.displayName,
            role: s.role,
            requiredReports: s.requiredReports,
          })),
        },
      });
    }),
  );

}
