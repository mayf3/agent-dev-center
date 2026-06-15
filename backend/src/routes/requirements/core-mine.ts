/**
 * Core Mine Route
 *
 * GET /mine — my active tasks (agent heartbeat endpoint)
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { serializeRequirement } from '../../utils/status.js';
import { parseSteps, getCurrentStep, mapUserRole } from './workflow-helpers.js';

export function registerCoreMineRoutes(router: import('express').Router): void {

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const actor = req.user!;

    const terminalSteps = ['done', 'abandoned', 'cancelled', 'rejected'];
    const requesterSteps = ['draft', 'pm_review'];

    const where: Prisma.RequirementWhereInput = {
      assigneeId: actor.id,
      currentStep: { notIn: [...terminalSteps, ...requesterSteps] },
    };

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

    const [requirements, total] = await prisma.$transaction([
      prisma.requirement.findMany({
        where,
        include: {
          tasks: true,
          assigneeUser: { select: { name: true } },
          workflow: { select: { steps: true, name: true, displayName: true } },
        },
        orderBy: [
          { priority: 'asc' },
          { updatedAt: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.requirement.count({ where }),
    ]);

    const items = requirements.map(r => {
      let nextAction: string | null = null;
      let requiredReports: string[] = [];

      if (r.workflow && r.currentStep) {
        try {
          const steps = parseSteps(r.workflow.steps as any);
          const currentStepDef = getCurrentStep(steps, r.currentStep);
          if (currentStepDef) {
            requiredReports = currentStepDef.requiredReports;
            const matchedRole = mapUserRole(actor.internalRole, currentStepDef.role);
            const canOperate = !!matchedRole || actor.role === 'admin' || actor.role === 'cto_agent';

            if (canOperate) {
              if (currentStepDef.requiredReports.length > 0) {
                nextAction = `submit ${currentStepDef.requiredReports.join(' + ')} reports then advance`;
              } else {
                nextAction = `can advance to next step`;
              }
            } else {
              nextAction = `waiting for ${currentStepDef.role} role`;
            }
          }
        } catch {
          nextAction = null;
        }
      }

      return {
        ...serializeRequirement(r),
        workflow: r.workflow ? {
          name: r.workflow.name,
          displayName: r.workflow.displayName,
        } : null,
        nextAction,
        requiredReports,
      };
    });

    res.json({
      data: items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  })
);

}
