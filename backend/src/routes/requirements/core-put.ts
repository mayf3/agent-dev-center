/**
 * Core PUT Route
 *
 * PUT /:id — full update
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  updateRequirementSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { validateAssigneeRoleMatch } from '../../lib/assignee-resolver.js';
import { notifyEvent } from '../../utils/notifications.js';
import { canEditRequirement } from './utils.js';

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
} satisfies Prisma.RequirementInclude;

export function registerCorePutRoutes(router: import('express').Router): void {

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = updateRequirementSchema.parse({ params: req.params, body: req.body });
    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, 'requirement not found');
    if (!canEditRequirement(req.user!, existing)) throw new HttpError(403, 'forbidden');

    let assigneeId = existing.assigneeId;
    let assigneeName: string | null = existing.assignee;
    if (body.assignee !== undefined) {
      if (body.assignee) {
        let assigneeUser;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.assignee)) {
          assigneeUser = await prisma.user.findUnique({
            where: { id: body.assignee },
            select: { id: true, name: true }
          });
        } else {
          assigneeUser = await prisma.user.findFirst({
            where: { OR: [{ name: body.assignee }, { email: body.assignee }] },
            select: { id: true, name: true }
          });
        }
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

    if (body.requester && body.requester !== existing.requester) {
      const requesterUser = await prisma.user.findFirst({
        where: { name: body.requester },
        select: { id: true, name: true }
      });
      if (!requesterUser) {
        throw new HttpError(400, `requester「${body.requester}」not found in users table`);
      }
    }

    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: {
        title: body.title, description: body.description, priority: body.priority,
        type: body.type, tags: body.tags,
        requester: body.requester, department: body.department,
        assignee: assigneeName, assigneeId, dueDate: body.dueDate, attachment: body.attachment,
        notes: body.notes,
        ...(body.projectId !== undefined && { projectId: body.projectId }),
        dependsOnIds: body.dependsOnIds
      },
      include: requirementInclude
    });

    // handle dependsOnIds changes: update blockedBy reverse references
    if (body.dependsOnIds !== undefined) {
      const oldDeps = new Set(existing.dependsOnIds || []);
      const newDeps = new Set(body.dependsOnIds);

      for (const depId of [...newDeps].filter(id => !oldDeps.has(id))) {
        const dep = await prisma.requirement.findUnique({ where: { id: depId }, select: { id: true, blockedBy: true } });
        if (!dep) continue;
        const newBlockedBy = [...(dep.blockedBy || []), params.id];
        await prisma.requirement.update({ where: { id: depId }, data: { blockedBy: newBlockedBy } });
      }

      for (const depId of [...oldDeps].filter(id => !newDeps.has(id))) {
        const dep = await prisma.requirement.findUnique({ where: { id: depId }, select: { id: true, blockedBy: true } });
        if (!dep) continue;
        const newBlockedBy = (dep.blockedBy || []).filter(id => id !== params.id);
        await prisma.requirement.update({ where: { id: depId }, data: { blockedBy: newBlockedBy } });
      }
    }

    await prisma.requirementRevision.create({
      data: {
        requirementId: params.id, title: existing.title, description: existing.description,
        priority: existing.priority, status: 'pending', requester: existing.requester,
        department: existing.department, assignee: existing.assignee, dueDate: existing.dueDate,
        attachment: existing.attachment, revisionNote: 'content edited', operatorId: req.user!.id,
      }
    });

    void notifyEvent('requirement.updated', {
      id: updated.id, title: updated.title, actor: req.user!.name, assignee: assigneeName
    });

    res.json(serializeRequirement(updated));
  })
);

}
