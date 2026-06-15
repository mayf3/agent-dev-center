/**
 * Workflow WIP Routes
 *
 * GET /workflow/wip-status                    — query WIP status for all steps
 * PATCH /workflow-templates/:id/step-wip      — update step WIP limit (admin/cto only)
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { parseSteps } from './workflow-helpers.js';

export function registerWorkflowWipRoutes(router: import('express').Router): void {

  router.get(
    '/workflow/wip-status',
    asyncHandler(async (_req, res) => {
      const templates = await prisma.workflowTemplate.findMany({
        where: { isActive: true },
        select: { id: true, name: true, displayName: true, steps: true },
      });

      const result: Array<{
        templateId: string;
        templateName: string;
        templateDisplayName: string;
        steps: Array<{
          stepName: string;
          stepDisplayName: string;
          wipLimit: number;
          currentCount: number;
          isOverLimit: boolean;
          requirements: Array<{ id: string; title: string; priority: string }>;
        }>;
      }> = [];

      for (const template of templates) {
        const steps = parseSteps(template.steps);
        const wipSteps = steps.filter(s => s.wipLimit && s.wipLimit > 0);

        if (wipSteps.length === 0) continue;

        const stepStats = [];
        for (const step of wipSteps) {
          const requirements = await prisma.requirement.findMany({
            where: { currentStep: step.name },
            select: { id: true, title: true, priority: true },
            orderBy: { createdAt: 'asc' },
          });

          stepStats.push({
            stepName: step.name,
            stepDisplayName: step.displayName,
            wipLimit: step.wipLimit!,
            currentCount: requirements.length,
            isOverLimit: requirements.length >= step.wipLimit!,
            requirements: requirements.map(r => ({
              id: r.id,
              title: r.title,
              priority: r.priority,
            })),
          });
        }

        result.push({
          templateId: template.id,
          templateName: template.name,
          templateDisplayName: template.displayName,
          steps: stepStats,
        });
      }

      res.json({ success: true, data: result });
    }),
  );

  router.patch(
    '/workflow-templates/:id/step-wip',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const templateId = req.params.id as string;
      const { stepName, wipLimit } = req.body as { stepName?: string; wipLimit?: number | null };

      if (!stepName || typeof stepName !== 'string') {
        throw new HttpError(400, 'stepName is required');
      }
      if (wipLimit !== null && wipLimit !== undefined && (!Number.isInteger(wipLimit) || wipLimit < 1)) {
        throw new HttpError(400, 'wipLimit must be a positive integer or null');
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
          return { ...s, wipLimit: wipLimit ?? undefined };
        }
        return s;
      });

      await prisma.workflowTemplate.update({
        where: { id: templateId },
        data: { steps: updatedSteps as any },
      });

      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_STEP_WIP_UPDATED',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: templateId,
          targetType: 'WorkflowTemplate',
          details: { stepName, wipLimit, templateName: template.name } as any,
        },
      });

      res.json({
        success: true,
        data: {
          templateId,
          stepName,
          wipLimit: wipLimit ?? null,
          previousWipLimit: targetStep.wipLimit ?? null,
        },
      });
    }),
  );

}
