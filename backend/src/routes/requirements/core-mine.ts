/**
 * Core Mine Route
 *
 * GET /mine — my active tasks (agent heartbeat endpoint)
 *
 * Supports view=summary / view=detail.
 * Default (no view): detail — backward compatible.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { serializeRequirement } from '../../utils/status.js';
import { getWorkflowSteps, getCurrentStep, mapUserRole } from './workflow-helpers.js';
import { requirementViewSchema } from '../../schemas/requirements.js';
import {
  REQUIREMENT_SUMMARY_SELECT,
  REQUIREMENT_SUMMARY_KEYS,
  toRequirementSummary,
} from './requirement-selects.js';

export function registerCoreMineRoutes(router: import('express').Router): void {

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const view = requirementViewSchema.parse(req.query.view);

    const terminalSteps = ['done', 'abandoned', 'cancelled', 'rejected'];
    const requesterSteps = ['draft', 'pm_review'];

    const where: Prisma.RequirementWhereInput = {
      assigneeId: actor.id,
      currentStep: { notIn: [...terminalSteps, ...requesterSteps] },
    };

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

    const [requirements, total] = await prisma.$transaction([
      view === 'summary'
        ? prisma.requirement.findMany({
            where,
            select: REQUIREMENT_SUMMARY_SELECT,
            orderBy: [
              { priority: 'asc' },
              { updatedAt: 'desc' },
            ],
            skip: (page - 1) * pageSize,
            take: pageSize,
          })
        : prisma.requirement.findMany({
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

    if (view === 'summary') {
      res.json({
        data: (requirements as any[]).map(toRequirementSummary),
        meta: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
      return;
    }

    const items = (requirements as any[]).map(r => {
      let nextAction: string | null = null;
      let requiredReports: string[] = [];

      if ((r.workflow || r.workflowSnapshot) && r.currentStep) {
        try {
          const steps = getWorkflowSteps(r);
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
