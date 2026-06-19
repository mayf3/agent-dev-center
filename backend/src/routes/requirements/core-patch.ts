import { prisma } from '../../lib/prisma.js';
import {
  patchRequirementSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { validateAssigneeRoleMatch, getAssigneeName } from '../../lib/assignee-resolver.js';
import { notifyEvent } from '../../utils/notifications.js';
import { canEditRequirement } from './utils.js';

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
} as const;

export function registerCorePatchRoutes(router: import('express').Router): void {

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = patchRequirementSchema.parse({ params: req.params, body: req.body });

    if (body.currentStep !== undefined || body.status !== undefined) {
      throw new HttpError(400, 'PATCH does not support currentStep/status changes. Use workflow/advance, workflow/reject, or workflow/lifecycle API.');
    }

    const existing = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { workflow: { select: { steps: true } } },
    });
    if (!existing) throw new HttpError(404, 'requirement not found');
    if (!canEditRequirement(req.user!, existing)) throw new HttpError(403, 'forbidden');

    if (existing.currentStep === 'pm_review') {
      const user = req.user!;
      const isPmRole = user.internalRole === 'pm' || user.role === 'pm';
      const isAdmin = user.role === 'admin';
      if (isPmRole && !isAdmin) {
        const pmProtectedFields = ['title', 'description', 'priority', 'department'];
        const blockedFields: string[] = [];
        if (body.title !== undefined && pmProtectedFields.includes('title')) blockedFields.push('title');
        if (body.description !== undefined && pmProtectedFields.includes('description')) blockedFields.push('description');
        if (blockedFields.length > 0) {
          throw new HttpError(403, `Cannot modify fields during pm_review: ${blockedFields.join(', ')}`);
        }
      }
    }

    let assigneeId = existing.assigneeId;
    let assigneeName: string | null = existing.assignee;

    if (body.assignee !== undefined) {
      if (body.assignee) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.assignee)) {
          throw new HttpError(400, 'assignee does not accept UUID format, use valid name or email');
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

        const roleCheck = await validateAssigneeRoleMatch(params.id, assigneeId);
        if (!roleCheck.ok) {
          throw new HttpError(400, roleCheck.message);
        }
      } else {
        assigneeId = null;
        assigneeName = null;
      }
    }

    if (body.workflowId !== undefined) {
      throw new HttpError(400, 'Cannot directly modify workflowId via PATCH. Use workflow/assign endpoint.');
    }

    const patchData: Record<string, unknown> = {};
    if (body.assignee !== undefined) { patchData.assignee = assigneeName; patchData.assigneeId = assigneeId; }
    if (body.rejectReason !== undefined) patchData.rejectReason = body.rejectReason;
    if (body.gitHash !== undefined) patchData.gitHash = body.gitHash;
    if (body.deployVersion !== undefined) patchData.deployVersion = body.deployVersion;
    if (body.title !== undefined) patchData.title = body.title;
    if (body.description !== undefined) patchData.description = body.description;

    if (Object.keys(patchData).length === 0) {
      throw new HttpError(400, 'no valid fields to update');
    }

    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: patchData,
      include: requirementInclude
    });

    void notifyEvent('requirement.updated', {
      id: updated.id, title: updated.title, actor: req.user!.name, assignee: assigneeName
    });

    res.json(serializeRequirement(updated));
  })
);

}
