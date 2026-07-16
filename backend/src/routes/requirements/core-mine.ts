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
  toRequirementSummary,
} from './requirement-selects.js';
import { computeNextAction, canOperateStep } from './mine-next-action-helper.js';

export function registerCoreMineRoutes(router: import('express').Router): void {

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const view = requirementViewSchema.parse(req.query.view);

    const terminalSteps = ['done', 'abandoned', 'cancelled', 'rejected'];
    const requesterSteps = ['draft'];

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
              // Only select the fields needed for nextAction computation.
              // Never load content / reviewComment / qaFindings / metadata.
              reports: { select: { id: true, reportType: true, status: true, createdAt: true } },
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
        meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
      return;
    }

    // ── Aggregate log for this response ──
    const actionHints: Array<{
      requirementId: string; currentStep: string; stepRole: string;
      assigneeId: string | null; nextActionCode: string;
    }> = [];

    const items = (requirements as any[]).map(r => {
      // ── Response isolation: reports are for internal calculation only ──
      // Strip reports before serialization so they never reach the HTTP body.
      const { reports: reportRecords, ...requirementForResponse } = r;

      let nextAction: string | null = null;
      let nextActionCode: string | null = null;
      let requiredReports: string[] = [];

      if ((requirementForResponse.workflow || requirementForResponse.workflowSnapshot) && requirementForResponse.currentStep) {
        try {
          const steps = getWorkflowSteps(requirementForResponse);
          const currentStepDef = getCurrentStep(steps, requirementForResponse.currentStep);
          if (currentStepDef) {
            requiredReports = currentStepDef.requiredReports;

            const actorCanOperate = canOperateStep({
              actorId: actor.id,
              actorRole: actor.role,
              actorInternalRole: actor.internalRole,
              stepRole: currentStepDef.role,
              assigneeId: requirementForResponse.assigneeId as string | null,
              mapUserRole,
            });

            const action = computeNextAction({
              currentStepName: requirementForResponse.currentStep,
              requiredReports,
              reportRecords: (reportRecords ?? []) as Array<{ reportType: string; status: string }>,
              stepRole: currentStepDef.role,
              actorCanOperate,
              actorId: actor.id,
              actorRole: actor.role,
              stepAssigneeId: requirementForResponse.assigneeId as string | null,
            });
            nextAction = action.text;
            nextActionCode = action.code;

            actionHints.push({
              requirementId: requirementForResponse.id,
              currentStep: requirementForResponse.currentStep,
              stepRole: currentStepDef.role,
              assigneeId: requirementForResponse.assigneeId as string | null,
              nextActionCode: action.code,
            });
          }
        } catch {
          nextAction = null;
          nextActionCode = null;
        }
      }

      return {
        ...serializeRequirement(requirementForResponse),
        workflow: requirementForResponse.workflow ? {
          name: requirementForResponse.workflow.name,
          displayName: requirementForResponse.workflow.displayName,
        } : null,
        nextAction,
        nextActionCode,
        requiredReports,
      };
    });

    // ── Structured log: one aggregated line per request ──
    try {
      if (actionHints.length > 0) {
        console.info(JSON.stringify({
          event: 'requirement_mine_action_hints',
          ts: new Date().toISOString(),
          actorId: actor.id,
          actorInternalRole: actor.internalRole,
          actorRole: actor.role,
          itemCount: actionHints.length,
          items: actionHints,
        }));
      }
    } catch {
      // log failure must not affect response
    }

    res.json({
      data: items,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  })
);

}
