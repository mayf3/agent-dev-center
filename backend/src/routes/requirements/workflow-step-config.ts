/**
 * Workflow Step Config Routes
 *
 * PATCH /workflow-templates/:id/step-mode — update step assigneeMode (admin/cto only)
 * PATCH /workflow-templates/:id/role-map  — update template roleUserMap (admin/cto only)
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { parseSteps } from './workflow-helpers.js';

export function registerWorkflowStepConfigRoutes(router: import('express').Router): void {

  router.patch(
    '/workflow-templates/:id/step-mode',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const templateId = req.params.id as string;
      const { stepName, assigneeMode } = req.body as { stepName?: string; assigneeMode?: string };

      if (!stepName || typeof stepName !== 'string') {
        throw new HttpError(400, 'stepName is required');
      }
      if (!assigneeMode || !['role-based', 'creator', 'fixed'].includes(assigneeMode)) {
        throw new HttpError(400, 'assigneeMode must be one of: role-based / creator / fixed');
      }

      const template = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
      if (!template) throw new HttpError(404, 'template not found');

      const steps = parseSteps(template.steps);
      const targetStep = steps.find(s => s.name === stepName);
      if (!targetStep) {
        throw new HttpError(400, `step「${stepName}」not found, available: ${steps.map(s => s.name).join(', ')}`);
      }

      const updatedSteps = steps.map(s => {
        if (s.name === stepName) {
          return { ...s, assigneeMode };
        }
        return s;
      });

      const stepsData = { ...template.steps as any };
      if (Array.isArray(stepsData)) {
        await prisma.workflowTemplate.update({
          where: { id: templateId },
          data: { steps: updatedSteps as any },
        });
      } else {
        await prisma.workflowTemplate.update({
          where: { id: templateId },
          data: { steps: { ...stepsData, steps: updatedSteps } as any },
        });
      }

      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_STEP_MODE_UPDATED',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: templateId,
          targetType: 'WorkflowTemplate',
          details: { stepName, assigneeMode, templateName: template.name } as any,
        },
      });

      res.json({
        success: true,
        data: {
          templateId,
          stepName,
          assigneeMode,
        },
      });
    }),
  );

  router.patch(
    '/workflow-templates/:id/role-map',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const templateId = req.params.id as string;
      const { roleUserMap } = req.body as { roleUserMap?: Record<string, string> };

      if (!roleUserMap || typeof roleUserMap !== 'object' || Object.keys(roleUserMap).length === 0) {
        throw new HttpError(400, 'roleUserMap must be a non-empty object');
      }

      const template = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
      if (!template) throw new HttpError(404, 'template not found');

      const currentSteps = parseSteps(template.steps);

      await prisma.workflowTemplate.update({
        where: { id: templateId },
        data: {
          steps: {
            steps: currentSteps,
            roleUserMap,
          } as any,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_TEMPLATE_ROLE_MAP_UPDATED',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: templateId,
          targetType: 'WorkflowTemplate',
          details: {
            templateName: template.name,
            roleUserMap,
          } as any,
        },
      });

      res.json({
        success: true,
        data: {
          templateId,
          roleUserMap,
        },
      });
    }),
  );

}
