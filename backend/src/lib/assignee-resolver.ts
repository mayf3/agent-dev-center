/**
 * Assignee Resolver — 工作流步骤角色 → 用户自动映射
 *
 * v3 (snapshot-first):
 * - 从 workflowSnapshot 解析 roleUserMap + assigneeMode
 * - mode 判断在 hasRoleUserMap **之前**（creator/fixed 不依赖 roleUserMap）
 * - role-based: 有 roleUserMap → 精准分配；无 → internalRole fallback
 * - roleUserMap 映射的 userId 会做用户存在性检查（M4）
 */
import { prisma } from './prisma.js';
import { getWorkflowSteps, getWorkflowRoleUserMap } from '../routes/requirements/workflow-helpers.js';

/**
 * Minimal user lookup interface — accepts any Prisma client (extended or plain)
 * that provides user.findUnique / user.findFirst.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AssigneeResolverDb = any;

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
 * Snapshot-first: 根据 workflowSnapshot 解析目标步骤的 assignee
 *
 * 语义（M1 重构）：
 * 1. requester 角色直接返回 requesterId
 * 2. mode 判断在 hasRoleUserMap 之前
 * 3. creator/fixed 不依赖 roleUserMap
 * 4. role-based: 有 roleUserMap → 精准（检查用户存在性 M4）；无 → internalRole fallback
 *
 * @param stepRole - 目标步骤的 role 字段
 * @param currentAssigneeId - 当前 assignee
 * @param requirement - 需求对象（需要 requesterId, assigneeId）
 * @param workflowSnapshot - 工作流快照
 * @param targetStepName - 目标步骤名称
 * @param db - 可选的 Prisma client（用于测试和事务内查询）
 * @returns 目标 assignee 的用户 ID
 * @throws { Error } 各种业务错误（配置错误、用户不存在等）
 */
export async function resolveAssigneeFromSnapshot(
  stepRole: string,
  currentAssigneeId: string | null | undefined,
  requirement: { requesterId: string | null; assigneeId: string | null } | null | undefined,
  workflowSnapshot: unknown,
  targetStepName: string,
  db?: AssigneeResolverDb,
): Promise<string | null> {
  const client = db ?? prisma;

  // requester 角色特殊处理 — 不走 mode 判断
  if (stepRole === 'requester') {
    return requirement?.requesterId ?? currentAssigneeId ?? null;
  }

  // 解析 assigneeMode（从 snapshot 中读取目标步骤的 mode）
  const mode = parseAssigneeMode(workflowSnapshot, targetStepName);

  // 解析 roleUserMap
  const roleUserMap = getWorkflowRoleUserMap(workflowSnapshot);

  switch (mode) {
    case 'creator': {
      if (!requirement?.requesterId) {
        throw new Error('assigneeMode=creator 但需求没有 requesterId');
      }
      return requirement.requesterId;
    }

    case 'fixed': {
      if (!currentAssigneeId) {
        throw new Error('assigneeMode=fixed 但当前 assignee 为空，无法保持');
      }
      return currentAssigneeId;
    }

    case 'role-based':
    default: {
      // 有 roleUserMap → 精准分配
      if (roleUserMap && Object.keys(roleUserMap).length > 0) {
        const userId = roleUserMap[stepRole];
        if (!userId) {
          throw new Error(
            `roleUserMap 中未找到 role「${stepRole}」的映射，`
            + `已配置的角色: ${Object.keys(roleUserMap).join(', ')}`,
          );
        }

        // M4: 用户存在性检查
        const user = await client.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        if (!user) {
          throw new Error(
            `roleUserMap 映射的用户 ${userId} 不存在（role: ${stepRole}）`,
          );
        }

        return userId;
      }

      // 无/null/空 map → internalRole fallback（历史兼容）
      return resolveAssigneeByInternalRole(stepRole, currentAssigneeId, client);
    }
  }
}

/**
 * 从 snapshot 中解析目标步骤的 assigneeMode
 */
function parseAssigneeMode(
  workflowSnapshot: unknown,
  targetStepName: string,
): 'role-based' | 'creator' | 'fixed' {
  if (!workflowSnapshot) return 'role-based';

  try {
    const steps = getWorkflowSteps(workflowSnapshot);
    const targetStep = steps.find(s => s.name === targetStepName);
    if (targetStep && 'assigneeMode' in targetStep) {
      const mode = (targetStep as any).assigneeMode;
      if (mode === 'creator' || mode === 'fixed' || mode === 'role-based') {
        return mode;
      }
    }
  } catch {
    // 解析失败使用默认值
  }

  return 'role-based';
}

/**
 * 旧逻辑：根据工作流步骤的 role 找到对应的用户 ID（基于 internalRole）
 *
 * 优先级：
 * 1. 如果传入 currentAssigneeId 且该用户的 internalRole 匹配 → 保持不变
 * 2. 从 users 表找 internalRole 匹配的第一个活跃用户
 */
export async function resolveAssigneeForStep(
  stepRole: string,
  currentAssigneeId?: string | null,
  db?: AssigneeResolverDb,
): Promise<string | null> {
  return resolveAssigneeByInternalRole(stepRole, currentAssigneeId, db);
}

async function resolveAssigneeByInternalRole(
  stepRole: string,
  currentAssigneeId?: string | null,
  db?: AssigneeResolverDb,
): Promise<string | null> {
  const client = db ?? prisma;

  if (stepRole === 'requester') {
    return currentAssigneeId ?? null;
  }

  const internalRole = WORKFLOW_ROLE_TO_INTERNAL[stepRole];
  if (!internalRole) return currentAssigneeId ?? null;

  // 如果当前 assignee 的角色匹配，保持不变
  if (currentAssigneeId) {
    const current = await client.user.findUnique({
      where: { id: currentAssigneeId },
      select: { internalRole: true },
    });
    if (current?.internalRole === internalRole) {
      return currentAssigneeId;
    }
  }

  // 查找匹配角色的用户（按创建时间排序，保证确定性）
  const match = await client.user.findFirst({
    where: { internalRole: internalRole as any },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (match?.id) return match.id;

  // 兜底：找不到匹配用户时分配给 CTO
  const cto = await client.user.findFirst({
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
 * @param targetStepName 可选，步骤变更时传入目标步骤名
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
    select: { workflowId: true, currentStep: true, workflowSnapshot: true },
  });
  if (!requirement?.workflowId || !requirement.currentStep) return { ok: true };

  // Kernel Phase 2A: prefer workflowSnapshot over live template
  let rawSteps: unknown;
  if (requirement.workflowSnapshot !== null) {
    rawSteps = requirement.workflowSnapshot;
  } else {
    const template = await prisma.workflowTemplate.findFirst({
      where: { id: requirement.workflowId, isActive: true },
      select: { steps: true },
    });
    if (!template) return { ok: true };
    rawSteps = template.steps;
  }

  let steps: Array<{ name: string; role: string; displayName: string }>;
  try {
    steps = getWorkflowSteps(rawSteps) as any;
  } catch {
    return { ok: true };
  }

  const stepForValidation = targetStepName ?? requirement.currentStep;
  const stepDef = steps.find(s => s.name === stepForValidation);
  if (!stepDef) return { ok: true };

  const stepRole = stepDef.role;

  if (stepRole === 'requester') return { ok: true };

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
