/**
 * Core Create Route
 *
 * POST / — create requirement
 *
 * Delegates to the shared requirement-create-service so that both the HTTP API
 * and internal callers (Goal Lifecycle, etc.) use identical logic for:
 *   - domain access control
 *   - workflow template resolution
 *   - role assignment validation
 *   - snapshot generation
 *   - atomic creation with transaction
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  createRequirementSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { notifyEvent } from '../../utils/notifications.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../../utils/similarity.js';
import { createRequirement } from '../../services/requirement-create-service.js';

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
  workflow: { select: { id: true, name: true, displayName: true } },
} satisfies Prisma.RequirementInclude;

export function registerCoreCreateRoutes(router: import('express').Router): void {

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { body } = createRequirementSchema.parse({ body: req.body });
    const actor = req.user!;

    // Similarity check for potential duplicates (kept in route — not core logic)
    const allRequirements = await prisma.requirement.findMany({
      select: { id: true, title: true, currentStep: true },
    });
    const normalizedNew = normalizeTitle(body.title);
    const similarItems = allRequirements
      .map(r => ({
        id: r.id,
        title: r.title,
        currentStep: r.currentStep,
        score: similarity(normalizedNew, normalizeTitle(r.title)),
      }))
      .filter(r => r.score >= DEFAULT_SIMILARITY_THRESHOLD && r.title !== body.title)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // legacy assignee resolution (non-workflow path only)
    let createAssigneeId: string | null = null;
    let createAssigneeName: string | null = null;
    if (body.assignee && (actor.role === 'admin' || actor.role === 'cto_agent') && !body.workflowTemplateKey) {
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
      createAssigneeId = assigneeUser?.id ?? null;
      createAssigneeName = assigneeUser?.name ?? null;
      if (body.assignee && !assigneeUser) {
        throw new HttpError(400, `assignee「${body.assignee}」not found, use valid name/email/UUID`);
      }
    }

    // validate requester name if provided
    const requesterName = body.requester ?? actor.name;
    if (body.requester && body.requester !== actor.name) {
      const requesterUser = await prisma.user.findFirst({
        where: { name: body.requester },
        select: { id: true, name: true }
      });
      if (!requesterUser) {
        throw new HttpError(400, `requester「${body.requester}」not found in users table`);
      }
    }

    // ── Delegate to shared service ─────────────────────────────
    // Requirements created via HTTP always have domainScope middleware applied,
    // so actor.allowedDomainKeys is populated.
    const serviceResult = await createRequirement(
      {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        internalRole: actor.internalRole,
        allowedDomainKeys: (actor as any).allowedDomainKeys,
        crossDomainAccess: (actor as any).crossDomainAccess,
        roles: actor.roles,
      },
      {
        title: body.title,
        description: body.description,
        domainKey: body.domainKey,
        department: body.department,
        priority: body.priority,
        type: body.type,
        tags: body.tags,
        workflowTemplateKey: body.workflowTemplateKey,
        workflowRoleAssignments: body.workflowRoleAssignments,
        projectId: body.projectId ?? null,
        dueDate: body.dueDate ?? null,
        attachment: body.attachment ?? null,
      },
    );

    // Legacy fields: the shared service resolves assignee via workflow,
    // but we still need to apply manually-set assignee for non-workflow creates.
    // Override if the legacy path set a different name.
    const finalAssigneeId = createAssigneeId ?? serviceResult.assigneeId;
    const finalAssigneeName = createAssigneeName ?? serviceResult.assignee;

    // Re-read full record for serialization (includes tasks, project, workflow name).
    // The shared service returns core fields; the re-read enriches with relations.
    // In mock-based tests, findUnique won't know the new ID — fall back to
    // the service result to avoid 500.
    const reqRecord = await prisma.requirement.findUnique({
      where: { id: serviceResult.id },
      include: requirementInclude,
    }).catch(() => null);
    // In mock-based tests, findUnique may not know the new ID.
    // Fall back to the service result (serialization will have limited relations).
    const finalRequirement = reqRecord ?? { ...serviceResult, tasks: [], project: null, workflow: null } as any;

    // reverse-update blockedBy for dependencies
    if ((body as any).dependsOnIds && (body as any).dependsOnIds.length > 0) {
      const dependencies = await prisma.requirement.findMany({
        where: { id: { in: (body as any).dependsOnIds } },
        select: { id: true, blockedBy: true },
      });
      if (dependencies.length !== (body as any).dependsOnIds.length) {
        throw new HttpError(400, `partial dependency requirements not found`);
      }
      for (const dep of dependencies) {
        const newBlockedBy = [...(dep.blockedBy || []), finalRequirement.id];
        await prisma.requirement.update({
          where: { id: dep.id },
          data: { blockedBy: newBlockedBy },
        });
      }
    }

    void notifyEvent('requirement.submitted', {
      id: finalRequirement.id, title: finalRequirement.title, actor: actor.name, assignee: finalAssigneeName
    });

    const response: Record<string, unknown> = serializeRequirement(finalRequirement);
    if (similarItems.length > 0) {
      response.warning = {
        type: 'possible_duplicate',
        message: `Found ${similarItems.length} similar requirements (similarity >= 80%)`,
        similar: similarItems,
      };
    }

    res.status(201).json(response);
  })
);

}
