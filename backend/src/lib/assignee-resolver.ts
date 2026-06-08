/**
 * Assignee Resolver — 工作流步骤角色 → 用户自动映射
 *
 * 核心原则：
 * - assigneeId 是唯一的真实字段（FK → users.id）
 * - assignee 文本字段废弃，API 输出通过 JOIN assigneeUser.name 获取
 * - 工作流 advance/reject 时自动查找下一步骤 role 对应的用户
 */
import { prisma } from './prisma.js';
import { getPlatformRoles, hasPlatformRole } from './platform-roles.js';

/** 工作流步骤 role → InternalRole 映射 */
const WORKFLOW_ROLE_TO_INTERNAL: Record<string, string> = {
  developer: 'developer',
  tester: 'tester',
  security: 'security',
  cto: 'cto',
  admin: 'cto',
  ops: 'ops',
  pm: 'pm',
  requester: 'pm',
  qa: 'qa',
};

/** 工作流步骤 role → ADC 平台角色映射 */
const WORKFLOW_ROLE_TO_PLATFORM: Record<string, string> = {
  developer: 'adc:developer',
  tester: 'adc:tester',
  security: 'adc:security',
  cto: 'adc:admin',
  admin: 'adc:admin',
  ops: 'adc:ops',
  pm: 'adc:pm',
  requester: 'adc:pm',
};

/**
 * 根据工作流步骤的 role 找到对应的用户 ID
 *
 * 优先级：
 * 1. 如果传入 currentAssigneeId 且该用户 roles 匹配 → 保持不变
 * 2. 从 users 表找 roles 匹配的第一个活跃用户
 * 3. 兼容期 fallback 到 internalRole
 */
export async function resolveAssigneeForStep(
  stepRole: string,
  currentAssigneeId?: string | null,
): Promise<string | null> {
  const internalRole = WORKFLOW_ROLE_TO_INTERNAL[stepRole];
  const platformRole = WORKFLOW_ROLE_TO_PLATFORM[stepRole];
  if (!internalRole || !platformRole) return currentAssigneeId ?? null;

  // 如果当前 assignee 的角色匹配，保持不变
  if (currentAssigneeId) {
    const current = await prisma.user.findUnique({
      where: { id: currentAssigneeId },
      select: { role: true, internalRole: true, roles: true },
    });
    if (current && hasPlatformRole(current, platformRole)) {
      return currentAssigneeId;
    }
  }

  // 先按平台 roles 查找匹配用户（按创建时间排序，保证确定性）
  const roleMatch = await prisma.user.findFirst({
    where: { roles: { has: platformRole } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, roles: true },
  });

  if (roleMatch?.id) return roleMatch.id;

  // 兼容期 fallback：按旧 internalRole 查找
  const match = await prisma.user.findFirst({
    where: { internalRole: internalRole as any },
    orderBy: { createdAt: 'asc' },
    select: { id: true, roles: true },
  });

  if (match?.id) return match.id;

  // 兜底：找不到匹配用户时分配给 CTO（避免 assignee 为空导致任务无人处理）
  const platformCto = await prisma.user.findFirst({
    where: { roles: { has: 'adc:admin' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, roles: true },
  });
  if (platformCto?.id) return platformCto.id;

  const cto = await prisma.user.findFirst({
    where: { internalRole: 'cto' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, roles: true },
  });
  return cto?.id ?? null;
}

/**
 * 通过 assigneeId 获取用户名（用于日志/通知）
 */
export async function getAssigneeName(assigneeId: string | null): Promise<string | null> {
  if (!assigneeId) return null;
  const user = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { name: true },
  });
  return user?.name ?? null;
}

/**
 * 验证 assigneeId 是否匹配需求当前工作流步骤的角色
 * 如果需求有工作流，assigneeId 指向的用户必须拥有该步骤所需的平台角色
 * 
 * @returns { ok: true } 或 { ok: false, message: string }
 */
export async function validateAssigneeRoleMatch(
  requirementId: string,
  assigneeUserId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!assigneeUserId) return { ok: true };

  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { workflowId: true, currentStep: true },
  });
  if (!requirement?.workflowId || !requirement.currentStep) return { ok: true };

  // 获取模板获取当前步骤 role
  const template = await prisma.workflowTemplate.findFirst({
    where: { id: requirement.workflowId, isActive: true },
    select: { steps: true },
  });
  if (!template) return { ok: true };

  const steps = template.steps as Array<{ name: string; role: string; displayName: string }>;
  const currentStepDef = steps.find(s => s.name === requirement.currentStep);
  if (!currentStepDef) return { ok: true };

  const stepRole = currentStepDef.role;
  const expectedInternalRole = WORKFLOW_ROLE_TO_INTERNAL[stepRole];
  const expectedPlatformRole = WORKFLOW_ROLE_TO_PLATFORM[stepRole];
  if (!expectedInternalRole || !expectedPlatformRole) return { ok: true };

  // 检查被分配用户的平台角色；roles 为空时 helper 会 fallback 到 internalRole
  const assigneeUser = await prisma.user.findUnique({
    where: { id: assigneeUserId },
    select: { name: true, role: true, internalRole: true, roles: true },
  });
  if (!assigneeUser) return { ok: false, message: `用户 ${assigneeUserId} 不存在` };

  if (!hasPlatformRole(assigneeUser, expectedPlatformRole)) {
    const actualRoles = getPlatformRoles(assigneeUser).join(', ') || assigneeUser.internalRole || '(未设置)';
    return {
      ok: false,
      message: `当前需求处于步骤「${currentStepDef.displayName}」（需要 ${stepRole} 角色），`
        + `但被分配用户「${assigneeUser.name}」的角色是 ${actualRoles}，不匹配需求当前步骤的角色要求`,
    };
  }

  return { ok: true };
}
