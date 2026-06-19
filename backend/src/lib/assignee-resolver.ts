/**
 * Assignee Resolver — 工作流步骤角色 → 用户映射（v2: assigneeMode + roleUserMap）
 *
 * 2026-06-14 重构 (6c70be0a):
 * - 消除所有 fallback 路径，改用 assigneeMode + roleUserMap 精准匹配
 * - 三种模式：role-based（查表）/ creator（需求创建者）/ fixed（保持当前）
 * - 角色不在 roleUserMap 中时抛出错误（不是静默 fallback）
 *
 * 向后兼容：当不传 options 时，回退到旧的 internalRole 查找逻辑（用于旧调用方）
 */
import { prisma } from './prisma.js';
import { getWorkflowRawJson, parseSteps, extractRoleUserMap } from '../routes/requirements/workflow-helpers.js';

/** 工作流步骤 role → InternalRole 映射（向后兼容用） */
const WORKFLOW_ROLE_TO_INTERNAL: Record<string, string> = {
  backend_developer: 'backend_developer',
  frontend_developer: 'frontend_developer',
  mobile_developer: 'mobile_developer',
  miniapp_developer: 'miniapp_developer',
  game_developer: 'game_developer',
  tester: 'tester',
  security: 'security',
  cto: 'cto',
  admin: 'cto',
  ops: 'ops',
  pm: 'pm',
  qa: 'qa',
  architect: 'architect',
};

/**
 * 根据 assigneeMode 和 roleUserMap 解析目标步骤的 assignee
 *
 * @param stepRole - 目标步骤的 role 字段
 * @param currentAssigneeId - 当前 assignee（向后兼容，用于旧模式）
 * @param options.assigneeMode - 'role-based' | 'creator' | 'fixed'（默认 'role-based'）
 * @param options.roleUserMap - role → userId 映射表（从模板读取）
 * @param options.requirement - 需求对象（需要 id, requesterId, assigneeId）
 * @returns 目标 assignee 的用户 ID，或 null
 * @throws { Error } 如果 role-based 模式且 role 不在 roleUserMap 中
 */
export async function resolveAssigneeForStep(
  stepRole: string,
  currentAssigneeId?: string | null,
  options?: {
    assigneeMode?: 'role-based' | 'creator' | 'fixed';
    roleUserMap?: Record<string, string> | null;
    requirement?: { id: string; requesterId: string | null; assigneeId: string | null };
  },
): Promise<string | null> {
  // ── 新逻辑：有 options 时使用 assigneeMode + roleUserMap ──
  if (options) {
    const { assigneeMode, roleUserMap, requirement } = options;
    const mode = assigneeMode ?? 'role-based';

    // requester 角色特殊处理
    if (stepRole === 'requester') {
      return requirement?.requesterId ?? currentAssigneeId ?? null;
    }

    switch (mode) {
      case 'creator': {
        if (!requirement?.requesterId) {
          throw new Error(`assigneeMode=creator 但需求没有 requesterId`);
        }
        return requirement.requesterId;
      }

      case 'fixed': {
        return requirement?.assigneeId ?? currentAssigneeId ?? null;
      }

      case 'role-based':
      default: {
        if (!roleUserMap || Object.keys(roleUserMap).length === 0) {
          throw new Error(
            `assigneeMode=role-based 但模板没有配置 roleUserMap，`
            + `无法为步骤 role「${stepRole}」分配用户`,
          );
        }

        const userId = roleUserMap[stepRole];
        if (!userId) {
          throw new Error(
            `roleUserMap 中未找到 role「${stepRole}」的映射，`
            + `已配置的角色: ${Object.keys(roleUserMap).join(', ')}`,
          );
        }

        return userId;
      }
    }
  }

  // ── 旧逻辑（向后兼容）：internalRole 查找 + fallback ──
  if (stepRole === 'requester') {
    return currentAssigneeId ?? null;
  }
  const internalRole = WORKFLOW_ROLE_TO_INTERNAL[stepRole];
  if (!internalRole) return currentAssigneeId ?? null;

  // 如果当前 assignee 的角色匹配，保持不变
  if (currentAssigneeId) {
    const current = await prisma.user.findUnique({
      where: { id: currentAssigneeId },
      select: { internalRole: true },
    });
    if (current?.internalRole === internalRole) {
      return currentAssigneeId;
    }
  }

  // 查找匹配角色的用户
  const match = await prisma.user.findFirst({
    where: { internalRole: internalRole as any },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (match?.id) return match.id;

  // 兜底：找不到时分配给 CTO
  const cto = await prisma.user.findFirst({
    where: { internalRole: 'cto' },
    select: { id: true },
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
 * 验证 assigneeId 是否匹配需求工作流步骤的角色
 *
 * @param targetStepName 可选，步骤变更时传入目标步骤名，用于正确校验角色
 * @returns { ok: true } 或 { ok: false; message: string }
 */
export async function validateAssigneeRoleMatch(
  requirementId: string,
  assigneeUserId: string | null,
  targetStepName?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!assigneeUserId) return { ok: true };

  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { workflowId: true, workflowSnapshot: true, currentStep: true, workflow: { select: { steps: true } } },
  });
  if (!requirement?.workflowId || !requirement.currentStep) return { ok: true };

  const rawData = getWorkflowRawJson(requirement);
  if (!rawData) return { ok: true };

  const stepsArray = parseSteps(rawData);

  // 确定用于校验的步骤
  const stepForValidation = targetStepName ?? requirement.currentStep;
  const stepDef = stepsArray.find(s => s.name === stepForValidation);
  if (!stepDef) return { ok: true };

  const stepRole = stepDef.role;

  // 特殊处理：requester 角色不校验
  if (stepRole === 'requester') return { ok: true };

  // 从 roleUserMap 校验 (snapshot or template)
  const roleUserMap = extractRoleUserMap(rawData);

  if (roleUserMap && roleUserMap[stepRole]) {
    if (roleUserMap[stepRole] !== assigneeUserId) {
      return {
        ok: false,
        message: `步骤「${stepDef.displayName}」（需要 ${stepRole} 角色），`
          + `roleUserMap 中该角色对应的用户不是当前 assignee`,
      };
    }
    return { ok: true };
  }

  // 兜底校验（没有 roleUserMap 时，走 internalRole 匹配）
  const expectedInternalRole = WORKFLOW_ROLE_TO_INTERNAL[stepRole];
  if (!expectedInternalRole) return { ok: true };

  const assigneeUser = await prisma.user.findUnique({
    where: { id: assigneeUserId },
    select: { name: true, internalRole: true },
  });
  if (!assigneeUser) return { ok: false, message: `用户 ${assigneeUserId} 不存在` };

  if (assigneeUser.internalRole !== expectedInternalRole) {
    return {
      ok: false,
      message: `步骤「${stepDef.displayName}」（需要 ${stepRole} 角色），`
        + `但被分配用户「${assigneeUser.name}」的 internalRole 是 ${assigneeUser.internalRole ?? '(未设置)'}，不匹配该步骤的角色要求`,
    };
  }

  return { ok: true };
}
