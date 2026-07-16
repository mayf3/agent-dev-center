/**
 * Core PATCH Route
 *
 * PATCH /:id — partial update (status change, assign, gitHash, deployVersion)
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  patchRequirementSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { validateAssigneeRoleMatch, resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import { notifyEvent } from '../../utils/notifications.js';
import { canEditRequirement } from './utils.js';
import { getWorkflowSteps, getCurrentStep } from './workflow-helpers.js';
import { recordRequirementEvent } from '../../services/requirement-event-ledger-service.js';
import { RequirementEventType } from '../../lib/requirement-event-types.js';

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
} satisfies Prisma.RequirementInclude;

export function registerCorePatchRoutes(router: import('express').Router): void {

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = patchRequirementSchema.parse({ params: req.params, body: req.body });
    const existing = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { workflow: { select: { steps: true } } },
    });
    if (!existing) throw new HttpError(404, 'requirement not found');
    if (!canEditRequirement(req.user!, existing)) throw new HttpError(403, 'forbidden');

    // pm_review field-level permission control
    if (existing.currentStep === 'pm_review') {
      const user = req.user!;
      const isPmRole = user.internalRole === 'pm' || user.role === 'pm';
      const isAdmin = user.role === 'admin';
      if (isPmRole && !isAdmin) {
        const pmProtectedFields = ['title', 'description', 'priority', 'department'];
        const blockedFields = pmProtectedFields.filter(f => (body as any)[f] !== undefined);
        if (blockedFields.length > 0) {
          throw new HttpError(403, `Cannot modify fields during pm_review: ${blockedFields.join(', ')}`);
        }
      }
    }

    // compute newStep for subsequent role validation
    let newStep = existing.currentStep;
    if (body.currentStep !== undefined) {
      newStep = body.currentStep;
    } else if (body.status !== undefined) {
      newStep = body.status;
    }
    const stepChanged = newStep !== existing.currentStep;

    // whitelist validation: PATCH currentStep only allows specific transitions
    if (stepChanged) {
      const PATCH_STEP_WHITELIST: Record<string, string[]> = {
        'pm_review': ['draft'],
        'draft': ['draft'],
      };
      const allowedTargets = existing.currentStep ? PATCH_STEP_WHITELIST[existing.currentStep] : undefined;
      if (!allowedTargets || !newStep || !allowedTargets.includes(newStep)) {
        throw new HttpError(
          400,
          `PATCH currentStep not supported from「${existing.currentStep}」to「${newStep}」. Use workflow advance/reject API.`
        );
      }
    }

    let assigneeId = existing.assigneeId;
    let assigneeName: string | null = existing.assignee;

    if (body.assignee !== undefined) {
      if (body.assignee) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.assignee)) {
          throw new HttpError(400, `assignee does not accept UUID format, use valid name or email`);
        }

        const assigneeUser = await prisma.user.findFirst({
          where: { OR: [{ name: body.assignee }, { email: body.assignee }] },
          select: { id: true, name: true }
        });

        if (!assigneeUser) {
          throw new HttpError(400, `assignee「${body.assignee}」not found`);
        }

        assigneeId = assigneeUser.id;
        assigneeName = assigneeUser.name;

        const roleCheck = await validateAssigneeRoleMatch(
          params.id, assigneeId,
          stepChanged ? (newStep ?? undefined) : undefined,
        );
        if (!roleCheck.ok) {
          throw new HttpError(400, roleCheck.message);
        }
      } else {
        assigneeId = null;
        assigneeName = null;
      }
    }

    // Guard: PATCH must not directly set workflowId
    if (body.workflowId !== undefined) {
      throw new HttpError(400, 'Cannot directly modify workflowId via PATCH. Use workflow/assign endpoint.');
    }

    // auto-resolve assignee when step changed and assignee not manually specified (snapshot-first)
    if (stepChanged && !body.assignee) {
      if (existing.workflowId) {
        const existingSteps = getWorkflowSteps(existing);
        const targetStepDef = getCurrentStep(existingSteps, newStep ?? '');
        if (targetStepDef?.role) {
          const resolvedId = await resolveAssigneeForStep(targetStepDef.role, existing.assigneeId);
          if (resolvedId) {
            assigneeId = resolvedId;
            assigneeName = await getAssigneeName(resolvedId);
          }
        }
      }
    }

    const patchData: Record<string, unknown> = {
      currentStep: newStep,
      assignee: assigneeName,
      assigneeId,
      rejectReason: body.rejectReason,
      gitHash: body.gitHash,
      deployVersion: body.deployVersion,
    };
    if (body.title !== undefined) patchData.title = body.title;
    if (body.description !== undefined) patchData.description = body.description;
    if (body.branch !== undefined) patchData.branch = body.branch;
    if (body.repoPath !== undefined) patchData.repoPath = body.repoPath;

    // ── Compute changed fields (metadata only, no values) ──
    const changedFields: string[] = [];
    if (body.title !== undefined) changedFields.push('title');
    if (body.description !== undefined) changedFields.push('description');
    if (body.assignee !== undefined) changedFields.push('assignee');
    if (body.currentStep !== undefined || body.status !== undefined) changedFields.push('currentStep');
    if (body.gitHash !== undefined) changedFields.push('gitHash');
    if (body.deployVersion !== undefined) changedFields.push('deployVersion');
    if (body.branch !== undefined) changedFields.push('branch');
    if (body.repoPath !== undefined) changedFields.push('repoPath');
    if (body.rejectReason !== undefined) changedFields.push('rejectReason');

    const hasAssigneeChange = body.assignee !== undefined;
    const hasStepChange = stepChanged;

    // ── 事务：业务更新 + Ledger 一同写入 ──
    const updated = await prisma.$transaction(async (tx: any) => {
      const before = await tx.requirement.findUniqueOrThrow({
        where: { id: params.id },
        select: {
          id: true, currentStep: true, assigneeId: true,
          stateVersion: true, status: true,
        },
      });

      const updated = await tx.requirement.update({
        where: { id: params.id },
        data: patchData,
        include: requirementInclude,
      });

      await recordRequirementEvent(tx, {
        requirementId: params.id,
        eventType: RequirementEventType.PATCH_UPDATED,
        actorId: req.user!.id, actorName: req.user!.name, actorType: 'human',
        fromStep: before.currentStep ?? null,
        toStep: updated.currentStep ?? null,
        fromAssigneeId: before.assigneeId ?? null,
        toAssigneeId: updated.assigneeId ?? null,
        stateVersionBefore: before.stateVersion ?? 0,
        stateVersionAfter: updated.stateVersion ?? before.stateVersion ?? 0,
        metadata: {
          changedFields,
          hasAssigneeChange,
          hasStepChange,
        },
        source: 'api.requirements.patch',
      });

      return updated;
    });

    void notifyEvent('requirement.updated', {
      id: updated.id, title: updated.title, actor: req.user!.name, assignee: assigneeName
    });

    res.json(serializeRequirement(updated));
  })
);

}
