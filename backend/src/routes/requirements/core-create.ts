/**
 * Core Create Route
 *
 * POST / — create requirement
 *
 * When workflowTemplateKey + workflowRoleAssignments are provided, the
 * workflow is assigned atomically in the same transaction (no separate
 * POST /:id/workflow/assign needed).
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
import { parseSteps, extractRoleUserMap, validateWorkflowSteps, getCurrentStep } from './workflow-helpers.js';

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

    // resolve assignee: support name/email/userId input
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

    // Resolve domainKey:
    // ALL consumers MUST provide domainKey explicitly.
    // The schema makes domainKey required; this fallback handles any edge case
    // where schema validation passes but body.domainKey is falsy.
    const domainKey = (() => {
      if (body.domainKey) return body.domainKey;
      throw new HttpError(400, 'domainKey is required');
    })();

    // Validate domain exists, is active, and user has access
    const domain = await prisma.businessDomain.findUnique({
      where: { key: domainKey },
      select: { key: true, isActive: true },
    });
    if (!domain) throw new HttpError(400, `domain「${domainKey}」not found`);
    if (!domain.isActive) throw new HttpError(400, `domain「${domainKey}」is inactive`);

    const hasDomainAccess = actor.crossDomainAccess ||
      (actor.allowedDomainKeys && actor.allowedDomainKeys.includes(domainKey));
    if (!hasDomainAccess) throw new HttpError(403, `no access to domain「${domainKey}」`);

    // ── Atomic create + workflow assign ─────────────────────
    // If workflowTemplateKey is provided, everything happens in one transaction.
    // The caller must also provide workflowRoleAssignments: { roleName: userId }.
    let workflowTemplate: { id: string; steps: unknown } | null = null;
    let targetCurrentStep: string | undefined;
    let workflowSnapshot: unknown;

    if (body.workflowTemplateKey) {
      workflowTemplate = await prisma.workflowTemplate.findUnique({
        where: { name: body.workflowTemplateKey },
        select: { id: true, steps: true },
      });
      if (!workflowTemplate) {
        throw new HttpError(400, `workflow template「${body.workflowTemplateKey}」not found`);
      }

      const steps = parseSteps(workflowTemplate.steps);
      if (steps.length === 0) {
        throw new HttpError(400, `workflow template「${body.workflowTemplateKey}」has no valid steps`);
      }

      // Validate workflow step routing
      const validationErrors = validateWorkflowSteps(steps);
      if (validationErrors.length > 0) {
        throw new HttpError(400, `workflow template validation failed: ${validationErrors.join('; ')}`);
      }

      // Collect unique step role names (excluding 'auto' and 'requester' which are special)
      const stepRoles = new Set(steps.map(s => s.role).filter(r => r !== 'auto' && r !== 'requester'));

      // Validate workflowRoleAssignments covers all required roles
      const assignments = body.workflowRoleAssignments ?? {};
      const missingRoles = [...stepRoles].filter(r => !assignments[r]);
      if (missingRoles.length > 0) {
        throw new HttpError(400, `workflow requires roles: ${[...stepRoles].join(', ')}, missing assignments for: ${missingRoles.join(', ')}`);
      }

      // Validate each assigned user exists
      for (const [role, userId] of Object.entries(assignments)) {
        const userExists = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        if (!userExists) {
          throw new HttpError(400, `user「${userId}」for role「${role}」not found`);
        }
      }

      // Determine first step
      const firstStep = steps[0];
      if (!firstStep) {
        throw new HttpError(400, 'workflow template has no steps');
      }

      // Build workflow snapshot with per-instance roleUserMap
      // The snapshot format is new-format: {steps, roleUserMap}
      const rawSnapshot = JSON.parse(JSON.stringify(workflowTemplate.steps));
      // rawSnapshot might be array (old format) or {steps, roleUserMap} (new format)
      const snapshot: Record<string, unknown> = {};
      if (Array.isArray(rawSnapshot)) {
        snapshot.steps = rawSnapshot;
      } else if (typeof rawSnapshot === 'object' && rawSnapshot !== null) {
        // Copy steps, then overlay roleUserMap
        Object.assign(snapshot, rawSnapshot);
      }
      snapshot.roleUserMap = { ...((snapshot.roleUserMap ?? {}) as Record<string, string>), ...assignments };
      workflowSnapshot = snapshot;

      targetCurrentStep = firstStep.name;

      // Resolve initial assignee from roleUserMap for the first step
      if (firstStep.role === 'requester') {
        createAssigneeId = actor.id;
        createAssigneeName = actor.name;
      } else if (firstStep.role === 'auto') {
        createAssigneeId = null;
        createAssigneeName = null;
      } else {
        const initialId = (snapshot.roleUserMap as Record<string, string>)[firstStep.role];
        if (initialId) {
          createAssigneeId = initialId;
          const userName = await prisma.user.findUnique({
            where: { id: initialId },
            select: { name: true },
          });
          createAssigneeName = userName?.name ?? null;
        }
      }
    }

    // ── Requirement creation (in transaction if workflow assign needed) ──
    const buildCreateData = () => ({
      title: body.title,
      description: body.description,
      priority: body.priority,
      type: body.type,
      tags: body.tags,
      requester: requesterName,
      requesterId: actor.id,
      department: body.department,
      assignee: createAssigneeName,
      assigneeId: createAssigneeId,
      dueDate: body.dueDate,
      attachment: body.attachment,
      projectId: body.projectId ?? null,
      dependsOnIds: (body as any).dependsOnIds ?? [],
      domainKey,
      ...(workflowTemplate ? {
        workflowId: workflowTemplate.id,
        workflowSnapshot: workflowSnapshot as Prisma.InputJsonValue,
        currentStep: targetCurrentStep,
      } : {}),
    });

    let requirement: any;
    if (workflowTemplate) {
      // Atomic create + workflow assign in single transaction
      requirement = await prisma.$transaction(async (tx) => {
        const req = await tx.requirement.create({
          data: buildCreateData(),
          include: requirementInclude,
        });
        return req;
      });
    } else {
      requirement = await prisma.requirement.create({
        data: buildCreateData(),
        include: requirementInclude,
      });
    }

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
        const newBlockedBy = [...(dep.blockedBy || []), requirement.id];
        await prisma.requirement.update({
          where: { id: dep.id },
          data: { blockedBy: newBlockedBy },
        });
      }
    }

    void notifyEvent('requirement.submitted', {
      id: requirement.id, title: requirement.title, actor: actor.name, assignee: createAssigneeName
    });

    const response: Record<string, unknown> = serializeRequirement(requirement);
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
