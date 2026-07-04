/**
 * Requirement Create Service
 *
 * Shared application service for creating ADC Requirements with optional
 * workflow assignment.  Used by both the HTTP POST /api/requirements route
 * and internal callers (Goal Lifecycle, etc.).
 *
 * Every caller MUST provide a properly resolved actor.  Domain access is
 * checked when the actor has domain-scope fields populated; otherwise a
 * backward-compatible pass-through is used.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { parseSteps, extractRoleUserMap, validateWorkflowSteps } from '../routes/requirements/workflow-helpers.js';
import { resolveDomainScope } from '../lib/domain-scope.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface CreateRequirementActor {
  id: string;
  name?: string | null;
  role: string;
  internalRole?: string | null;
  /** Set by domainScope middleware when loaded (undefined = middleware not loaded) */
  allowedDomainKeys?: string[] | undefined;
  /** Set by domainScope middleware when loaded (undefined = middleware not loaded) */
  crossDomainAccess?: boolean | undefined;
  /** Raw platform roles array from JWT/DB lookup */
  roles?: string[] | undefined;
}

export interface CreateRequirementInput {
  title: string;
  description: string;
  domainKey: string;
  department?: string;
  priority?: string;
  type?: string;
  tags?: string[];
  workflowTemplateKey?: string;
  workflowRoleAssignments?: Record<string, string>;
  projectId?: string | null;
  dueDate?: Date | string | null;
  attachment?: string | null;
}

export interface CreateRequirementResult {
  id: string;
  title: string;
  domainKey: string | null;
  currentStep: string | null;
  assigneeId: string | null;
  assignee: string | null;
  requesterId: string;
  requester: string;
  workflowId: string | null;
  workflowSnapshot: unknown;
  stateVersion: number;
}

// ─── Service ───────────────────────────────────────────────────────────────

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
  workflow: { select: { id: true, name: true, displayName: true } },
} satisfies Prisma.RequirementInclude;

/**
 * Create a requirement with optional workflow initialization.
 *
 * Domain access:
 *   - If `actor.allowedDomainKeys` is set (middleware loaded), domain access is enforced.
 *   - If `actor.allowedDomainKeys` is undefined (middleware NOT loaded), domain scope is
 *     resolved from the database at call time to maintain security.
 *
 * Workflow:
 *   - When `input.workflowTemplateKey` is provided, a workflow snapshot is taken and
 *     the first-step assignee is resolved from `input.workflowRoleAssignments`.
 *   - The requirement and metadata are created atomically in a single transaction.
 *
 * @throws HttpError with appropriate status code on validation failure.
 */
export async function createRequirement(
  actor: CreateRequirementActor,
  input: CreateRequirementInput,
  opts?: { prisma?: PrismaClient },
): Promise<CreateRequirementResult> {
  const db = opts?.prisma ?? defaultPrisma as unknown as PrismaClient;

  // ── 1. Resolve domain scope if not already loaded ─────────────────
  let allowedDomainKeys = actor.allowedDomainKeys;
  let crossDomainAccess = actor.crossDomainAccess ?? false;

  if (allowedDomainKeys === undefined) {
    // Middleware not loaded — resolve from DB now
    const scope = await resolveDomainScope(actor);
    allowedDomainKeys = scope.allowedDomainKeys;
    crossDomainAccess = scope.crossDomainAccess;
  }

  // ── 2. Validate domain exists, is active, and user has access ─────
  const domain = await db.businessDomain.findUnique({
    where: { key: input.domainKey },
    select: { key: true, isActive: true },
  });
  if (!domain) throw new HttpError(400, `domain「${input.domainKey}」not found`);
  if (!domain.isActive) throw new HttpError(400, `domain「${input.domainKey}」is inactive`);

  const hasDomainAccess = crossDomainAccess ||
    (allowedDomainKeys && allowedDomainKeys.includes(input.domainKey));
  if (!hasDomainAccess) throw new HttpError(403, `no access to domain「${input.domainKey}」`);

  // ── 3. Process workflow template if provided ─────────────────────
  let workflowId: string | null = null;
  let workflowSnapshot: Prisma.InputJsonValue | undefined;
  let targetCurrentStep: string | undefined;
  let assigneeId: string | null = null;
  let assigneeName: string | null = null;

  if (input.workflowTemplateKey) {
    const template = await db.workflowTemplate.findUnique({
      where: { name: input.workflowTemplateKey },
      select: { id: true, steps: true },
    });
    if (!template) {
      throw new HttpError(400, `workflow template「${input.workflowTemplateKey}」not found`);
    }

    const steps = parseSteps(template.steps);
    if (steps.length === 0) {
      throw new HttpError(400, `workflow template「${input.workflowTemplateKey}」has no valid steps`);
    }

    const validationErrors = validateWorkflowSteps(steps);
    if (validationErrors.length > 0) {
      throw new HttpError(400, `workflow template validation failed: ${validationErrors.join('; ')}`);
    }

    // Collect unique step role names (excluding 'auto' and 'requester')
    const stepRoles = new Set(steps.map(s => s.role).filter(r => r !== 'auto' && r !== 'requester'));

    // Validate workflowRoleAssignments covers all required roles
    const assignments = input.workflowRoleAssignments ?? {};
    const missingRoles = [...stepRoles].filter(r => !assignments[r]);
    if (missingRoles.length > 0) {
      throw new HttpError(400, `workflow requires roles: ${[...stepRoles].join(', ')}, missing assignments for: ${missingRoles.join(', ')}`);
    }

    // Validate each assigned user exists
    for (const [role, userId] of Object.entries(assignments)) {
      const userExists = await db.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!userExists) {
        throw new HttpError(400, `user「${userId}」for role「${role}」not found`);
      }
    }

    workflowId = template.id;

    // Build workflow snapshot with per-instance roleUserMap
    const rawSnapshot = JSON.parse(JSON.stringify(template.steps));
    const snapshot: Record<string, unknown> = {};
    if (Array.isArray(rawSnapshot)) {
      snapshot.steps = rawSnapshot;
    } else if (typeof rawSnapshot === 'object' && rawSnapshot !== null) {
      Object.assign(snapshot, rawSnapshot);
    }
    snapshot.roleUserMap = { ...((snapshot.roleUserMap ?? {}) as Record<string, string>), ...assignments };
    workflowSnapshot = snapshot as Prisma.InputJsonValue;

    // Determine first step
    const firstStep = steps[0];
    if (!firstStep) throw new HttpError(400, 'workflow template has no steps');
    targetCurrentStep = firstStep.name;

    // Resolve initial assignee
    if (firstStep.role === 'requester') {
      assigneeId = actor.id;
      assigneeName = actor.name ?? null;
    } else if (firstStep.role === 'auto') {
      assigneeId = null;
      assigneeName = null;
    } else {
      const initialId = (snapshot.roleUserMap as Record<string, string>)[firstStep.role];
      if (initialId) {
        assigneeId = initialId;
        const userName = await db.user.findUnique({
          where: { id: initialId },
          select: { name: true },
        });
        assigneeName = userName?.name ?? null;
      }
    }
  }

  // ── 4. Create requirement ────────────────────────────────────────
  const data: Prisma.RequirementUncheckedCreateInput = {
    title: input.title,
    description: input.description,
    priority: (input.priority as any) ?? 'P2',
    type: (input.type as any) ?? 'FEATURE',
    tags: input.tags ?? [],
    requester: actor.name ?? actor.id,
    requesterId: actor.id,
    department: input.department ?? 'engineering',
    assignee: assigneeName,
    assigneeId,
    domainKey: input.domainKey,
    ...(workflowId ? {
      workflowId,
      workflowSnapshot,
      currentStep: targetCurrentStep,
    } : {}),
  };

  // Use transaction only when workflow assign is needed (atomic create + snapshot);
  // for simple creates, use direct create to avoid breaking mock-based tests
  // that mock prisma.requirement.create directly.
  const requirement = workflowId
    ? await db.$transaction(async (tx) => {
        return tx.requirement.create({ data, include: requirementInclude });
      })
    : await db.requirement.create({ data: data as any, include: requirementInclude });

  return {
    id: requirement.id,
    title: requirement.title,
    domainKey: requirement.domainKey,
    currentStep: requirement.currentStep,
    assigneeId: requirement.assigneeId,
    assignee: requirement.assignee,
    requesterId: requirement.requesterId ?? actor.id,
    requester: requirement.requester,
    workflowId: requirement.workflowId,
    workflowSnapshot: requirement.workflowSnapshot,
    stateVersion: (requirement as any).stateVersion ?? 0,
  };
}
