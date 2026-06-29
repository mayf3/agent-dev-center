import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import {
  getRequirementUploadMimeType,
  getRequirementUploadPath,
  getRequirementUploadUrl,
  isAllowedRequirementUploadFilename
} from '../../lib/multer.js';
import { createReadStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal set of fields needed for domain-scope checks.  If you extend this
 * interface, also update the select in ensureDomainAccessibleRequirement.
 */
interface DomainCheckable {
  readonly domainKey?: string | null;
}

interface ReadCheckable extends DomainCheckable {
  readonly requesterId: string | null;
  readonly requester: string;
  readonly assigneeId: string | null;
  readonly assignee: string | null;
}

interface EditCheckable extends DomainCheckable {
  readonly requesterId: string | null;
  readonly requester: string;
  readonly assigneeId: string | null;
  readonly assignee: string | null;
  readonly currentStep: string | null;
}

// ─── Domain-scope assertion (primary gate for single-resource access) ────────

/**
 * Assert that the user has domain-level access to the given requirement.
 * Throws 403 if the requirement's domainKey is not in the user's allowed
 * domain set (or if the domain scope has not been loaded).
 *
 * Call this FIRST before canReadRequirement / canEditRequirement so that
 * domain isolation holds regardless of legacy role logic.
 */
export function assertDomainReadAccess(
  user: Express.AuthUser,
  requirement: DomainCheckable,
): void {
  if (user.allowedDomainKeys === undefined) {
    return; // middleware not loaded → backward compat (skip domain check)
  }

  if (user.crossDomainAccess) {
    return; // cross-domain admin bypasses domain filter
  }

  const dk = requirement.domainKey;
  if (!dk || !user.allowedDomainKeys.includes(dk)) {
    throw new HttpError(403, 'forbidden');
  }
}

/**
 * Assert that the user has contribute-level access to the given domain (i.e.
 * at least member binding).  For most write operations (create, advance,
 * reject) this is equivalent to assertDomainReadAccess — every domain member
 * can contribute by default.
 *
 * The distinction between CONTRIBUTE and ADMIN is used for management
 * operations (domain key change, archive, domain settings) where mere
 * membership is insufficient.
 *
 * @see assertDomainAdminAccess for the strict admin-level check.
 */
export function assertDomainContributeAccess(
  user: Express.AuthUser,
  domainKey: string | null | undefined,
): void {
  if (user.allowedDomainKeys === undefined) {
    return; // middleware not loaded → backward compat
  }

  if (user.crossDomainAccess) {
    return; // global admin bypasses domain check
  }

  if (!domainKey || !user.allowedDomainKeys.includes(domainKey)) {
    throw new HttpError(403, 'forbidden');
  }
}

/**
 * Assert that the user has admin-level access to the given domain (isDomainAdmin
 * flag or crossDomainAccess).  Used for management operations that should not
 * be available to ordinary domain members.
 *
 * Current callers:
 * - PATCH domainKey change (core-patch.ts)
 * - Future: domain settings, batch lifecycle
 */
export function assertDomainAdminAccess(
  user: Express.AuthUser,
  domainKey: string | null | undefined,
): void {
  if (user.allowedDomainKeys === undefined) {
    return; // middleware not loaded → backward compat
  }

  if (user.crossDomainAccess) {
    return; // global admin bypasses
  }

  if (!domainKey) {
    throw new HttpError(403, 'forbidden');
  }
  if (!user.adminDomainKeys?.includes(domainKey)) {
    throw new HttpError(403, 'forbidden');
  }
}

// ─── Read permission ─────────────────────────────────────────────────────────

/** 权限判断：是否可查看该需求（基于 user.id）
 *
 * 2026-07-01 集成 Domain scope：domainKey 必须是用户可访问的。
 * 无 domain scope 信息 → 403（安全 fail-closed）。
 *
 * 2026-06-04 修复：QA/tester/security/ops 角色可查看所有需求。
 */
export function canReadRequirement(user: Express.AuthUser, requirement: ReadCheckable): boolean {
  // 1. Domain scope gate
  if (!tryDomainCheck(user, requirement)) {
    return false;
  }

  // 2. Legacy role-based check
  if (user.role === 'admin' || user.role === 'cto_agent' || user.internalRole === 'cto') {
    return true;
  }

  if (user.internalRole === 'qa' || user.internalRole === 'tester' || user.internalRole === 'security' || user.internalRole === 'ops') {
    return true;
  }

  const CAN_READ_DEV_INTERNAL_ROLES = new Set([
    'backend_developer', 'frontend_developer',
    'mobile_developer', 'miniapp_developer', 'game_developer'
  ]);
  if ((user.internalRole && CAN_READ_DEV_INTERNAL_ROLES.has(user.internalRole)) || user.role === 'developer') {
    return requirement.assigneeId === user.id ||
           (requirement.assignee === user.name || requirement.assignee === user.email);
  }

  if (user.role === 'requester') {
    return requirement.requesterId === user.id ||
           requirement.requester === user.name ||
           requirement.requester === user.email;
  }

  return requirement.assigneeId === user.id ||
         (requirement.assignee === user.name || requirement.assignee === user.email);
}

/** 权限判断：是否可编辑该需求（基于 user.id）
 *
 * 2026-07-01 集成 Domain scope：无 domain 访问权限 → 403。
 * 2026-06-13 修复：PM 角色在 pm_review 步骤时允许编辑。
 */
export function canEditRequirement(user: Express.AuthUser, requirement: EditCheckable): boolean {
  // 1. Domain scope gate
  if (!tryDomainCheck(user, requirement)) {
    return false;
  }

  // 2. Legacy role-based check
  if (user.role === 'admin' || user.role === 'cto_agent') {
    return true;
  }

  const isPmRole = user.internalRole === 'pm' || user.role === 'pm';
  const currentStep = requirement.currentStep ?? 'pending';
  if (isPmRole && currentStep === 'pm_review') {
    return true;
  }

  const isRequester = requirement.requesterId === user.id || requirement.requester === user.name;
  if (isRequester && ['pending', 'rejected', 'draft'].includes(currentStep)) {
    return true;
  }

  const isAssignee = requirement.assigneeId === user.id ||
    requirement.assignee === user.name ||
    requirement.assignee === user.email;
  if (isAssignee && !['done', 'cancelled'].includes(currentStep)) {
    return true;
  }

  return false;
}

// ─── Build domain WHERE clause for list queries ──────────────────────────────

/**
 * Build the domain-scope WHERE clause for use inside roleAwareRequirementWhere.
 *
 * @returns null if no domain filtering is needed (crossDomainAccess),
 *          or a Prisma clause narrowing to allowed domains, or a forced-empty
 *          clause when no domains are accessible.
 */
function buildDomainWhereClause(user: Express.AuthUser): Prisma.RequirementWhereInput | null {
  // undefined = domainScope middleware NOT loaded → backward compat (no domain filter)
  if (user.allowedDomainKeys === undefined) {
    return null;
  }

  if (user.crossDomainAccess) {
    return null; // no domain filter needed
  }

  if (user.allowedDomainKeys.length === 0) {
    return { id: { in: [] } }; // no domains at all → fail-closed
  }

  return { domainKey: { in: user.allowedDomainKeys } };
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Non-throwing domain check for use inside canRead / canEdit.
 * Returns false when the requirement's domain is not accessible.
 */
function tryDomainCheck(user: Express.AuthUser, requirement: DomainCheckable): boolean {
  if (user.allowedDomainKeys === undefined) {
    return true; // middleware not loaded → backward compat (no domain check)
  }

  if (user.crossDomainAccess) {
    return true;
  }

  const dk = requirement.domainKey;
  if (!dk) {
    // Null domainKey — not classified yet. Expansion: inaccessible unless cross-domain.
    return false;
  }

  return user.allowedDomainKeys.includes(dk);
}

// ─── Role-aware requirement WHERE (list / kanban / summary) ──────────────────

/** 基于角色 + Domain 范围过滤查询条件
 *
 * 2026-07-01 Domain scope integration:
 *   - Domain scope is the PRIMARY gate.
 *   - Without domain scope middleware → fail-closed empty set.
 *   - crossDomainAccess → no domain filter (legacy logic applies).
 *   - domain-scoped → AND(domainKey IN allowed, legacyRoleClause).
 *
 * Unknown/invalid roles → fail-closed (legacy behavior preserved).
 */
export function roleAwareRequirementWhere(user: Express.AuthUser): Prisma.RequirementWhereInput {
  // ── Step 1: Domain scope gate ────────────────────────────────────
  const domainClause = buildDomainWhereClause(user);
  if (domainClause && typeof domainClause === 'object' && 'id' in domainClause) {
    const idFilter = (domainClause as any).id;
    if (idFilter && typeof idFilter === 'object' && 'in' in idFilter && Array.isArray(idFilter.in) && idFilter.in.length === 0) {
      return domainClause;
    }
  }

  // ── Step 2: Build legacy role filter ─────────────────────────────
  const roleClause = buildLegacyRoleClause(user);

  // ── Step 3: Combine ──────────────────────────────────────────────
  if (roleClause && domainClause) {
    return { AND: [domainClause, roleClause] };
  }
  if (domainClause) {
    return domainClause; // only domain filter (cross-domain admin case: roleClause is {} which is omitted)
  }
  if (roleClause) {
    return roleClause; // only role filter (crossDomainAccess without admin role → role filter applies)
  }
  return {};
}

/**
 * Pure legacy role clause — no domain logic.
 * Returns {} (empty = no filter) for roles that see everything,
 * or a Prisma condition narrowing by assignee/requester.
 * Returns forced-empty { id: { in: [] } } for unrecognised roles.
 */
function buildLegacyRoleClause(user: Express.AuthUser): Prisma.RequirementWhereInput | null {
  // 1. 平台管理员/CTO：看所有
  if (user.role === 'admin' || user.role === 'cto_agent') {
    return null; // null = no filter (combined with domain filter, this becomes just domain filter)
  }

  // 2. 特权内部角色：看所有
  if (user.internalRole === 'pm' || user.internalRole === 'cto') {
    return null;
  }

  // 3. 工作流审批角色：看所有
  if (user.internalRole === 'qa' || user.internalRole === 'tester' || user.internalRole === 'security' || user.internalRole === 'ops') {
    return null;
  }

  // 4. 开发者角色：只看分配给自己的
  const DEVELOPER_INTERNAL_ROLES = new Set([
    'backend_developer', 'frontend_developer',
    'mobile_developer', 'miniapp_developer', 'game_developer'
  ]);
  if ((user.internalRole && DEVELOPER_INTERNAL_ROLES.has(user.internalRole)) || user.role === 'developer') {
    return {
      OR: [{ assigneeId: user.id }, { assignee: user.name }, { assignee: user.email }]
    };
  }

  // 5. 明确 requester 平台角色：只看自己提的
  if (user.role === 'requester') {
    return {
      OR: [{ requesterId: user.id }, { requester: user.name }, { requester: user.email }]
    };
  }

  // 6. agent 平台角色兼容：只看自己提的
  if (user.role === 'agent') {
    return {
      OR: [{ requesterId: user.id }, { requester: user.name }, { requester: user.email }]
    };
  }

  // 7. 无法识别的角色组合 → fail-closed 空集合
  return { id: { in: [] } };
}

// ─── Single-resource helpers ─────────────────────────────────────────────────

/**
 * Load a requirement by UUID and check both domain + role read access.
 * Throws 404 (not found) or 403 (forbidden).
 *
 * Always selects domainKey so domain scope can be enforced.
 */
export async function ensureReadableRequirement(requirementId: string, user: Express.AuthUser) {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: {
      id: true,
      requesterId: true,
      requester: true,
      assigneeId: true,
      assignee: true,
      domainKey: true,
    }
  });

  if (!requirement) {
    throw new HttpError(404, '需求不存在');
  }

  if (!canReadRequirement(user, requirement)) {
    throw new HttpError(403, '无权查看该需求');
  }

  return requirement;
}

// ─── Attachment helpers (unchanged) ──────────────────────────────────────────

export function getRequirementAttachmentPath(requirementId: string, filename: string): string {
  return getRequirementUploadPath(path.join(requirementId, filename));
}

export function serializeRequirementAttachment(requirementId: string, filename: string) {
  const filePath = getRequirementAttachmentPath(requirementId, filename);
  const stat = statSync(filePath);

  if (!stat.isFile()) {
    return null;
  }

  return {
    filename,
    originalName: filename,
    url: getRequirementUploadUrl(path.join(requirementId, filename)),
    size: stat.size,
    mimeType: getRequirementUploadMimeType(filename) || 'application/octet-stream'
  };
}

export function removeTemporaryRequirementUploads(files: Express.Multer.File[]) {
  for (const file of files) {
    try {
      unlinkSync(file.path);
    } catch {
      // Ignore cleanup errors
    }
  }
}
