/**
 * Assignee Resolver — 工作流步骤角色 → 用户自动映射
 *
 * 核心原则：
 * - assigneeId 是唯一的真实字段（FK → users.id）
 * - assignee 文本字段废弃，API 输出通过 JOIN assigneeUser.name 获取
 * - 工作流 advance/reject 时自动查找下一步骤 role 对应的用户
 * - WIP 限制：分配时检查用户当前活跃需求数是否超过 wipLimit
 *
 * 2026-06-15: 新增 WIP 限制支持（per-user wipLimit 字段）
 */
import { prisma } from './prisma.js';

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
  qa: 'qa',  // 2026-06-05 新增 QA 步骤支持
};

/** 全局默认 WIP 上限 */
const DEFAULT_WIP_LIMIT = 2;

/**
 * 获取用户当前的活跃需求数量（currentStep != 'done'）
 */
export async function getActiveRequirementCount(userId: string): Promise<number> {
  return prisma.requirement.count({
    where: {
      assigneeId: userId,
      currentStep: { not: 'done' },
    },
  });
}

/**
 * 检查用户是否还有 WIP 容量
 */
export async function hasWipCapacity(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { wipLimit: true },
  });
  if (!user) return false;

  const limit = user.wipLimit ?? DEFAULT_WIP_LIMIT;
  const activeCount = await getActiveRequirementCount(userId);
  return activeCount < limit;
}

/**
 * 根据工作流步骤的 role 找到对应的用户 ID（带 WIP 容量检查）
 *
 * 优先级：
 * 1. 如果传入 currentAssigneeId 且该用户的 internalRole 匹配且有容量 → 保持不变
 * 2. 从 users 表找 internalRole 匹配且有 WIP 容量的用户
 * 3. 如果所有匹配用户都超限，分配 WIP 占用最少的用户
 * 4. 兜底：找不到匹配用户时分配给 CTO
 */
export async function resolveAssigneeForStep(
  stepRole: string,
  currentAssigneeId?: string | null,
): Promise<string | null> {
  const internalRole = WORKFLOW_ROLE_TO_INTERNAL[stepRole];
  if (!internalRole) return currentAssigneeId ?? null;

  // 如果当前 assignee 的角色匹配且有容量，保持不变
  if (currentAssigneeId) {
    const current = await prisma.user.findUnique({
      where: { id: currentAssigneeId },
      select: { internalRole: true },
    });
    if (current?.internalRole === internalRole) {
      const hasCapacity = await hasWipCapacity(currentAssigneeId);
      if (hasCapacity) {
        return currentAssigneeId;
      }
    }
  }

  // 查找匹配角色的所有用户，按 WIP 容量排序
  const candidates = await prisma.user.findMany({
    where: { internalRole: internalRole as any },
    select: { id: true, name: true, wipLimit: true },
  });

  if (candidates.length === 0) {
    // 兜底：找不到匹配用户时分配给 CTO
    const cto = await prisma.user.findFirst({
      where: { internalRole: 'cto' },
      select: { id: true },
    });
    return cto?.id ?? null;
  }

  // 计算每个候选用户的活跃需求数和剩余容量
  const usersWithLoad = await Promise.all(
    candidates.map(async (u) => {
      const activeCount = await getActiveRequirementCount(u.id);
      const limit = u.wipLimit ?? DEFAULT_WIP_LIMIT;
      const remaining = limit - activeCount;
      return { id: u.id, name: u.name, activeCount, limit, remaining };
    }),
  );

  // 先找有容量的用户
  const hasCapacity = usersWithLoad.filter(u => u.remaining > 0);
  if (hasCapacity.length > 0) {
    // 按剩余容量降序排列（容量多的优先）
    hasCapacity.sort((a, b) => b.remaining - a.remaining);
    return hasCapacity[0].id;
  }

  // 所有候选都超限：分配 WIP 占用最少的（负载均衡）
  usersWithLoad.sort((a, b) => a.activeCount - b.activeCount);
  const best = usersWithLoad[0];

  // 如果当前 assignee 角色匹配但不是最好的，仍然切换
  // 否则返回负载最低的用户
  return best.id;
}

/**
 * 获取用户当前 WIP 限制和计数
 */
export async function getUserWipInfo(userId: string): Promise<{
  activeCount: number;
  wipLimit: number;
  remaining: number;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { wipLimit: true, name: true },
  });
  if (!user) return null;

  const activeCount = await getActiveRequirementCount(userId);
  const wipLimit = user.wipLimit ?? DEFAULT_WIP_LIMIT;
  return { activeCount, wipLimit, remaining: wipLimit - activeCount };
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
 * 如果需求有工作流，assigneeId 指向的用户必须拥有该步骤所需的 internalRole
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
  if (!expectedInternalRole) return { ok: true };

  // 检查被分配用户的 internalRole
  const assigneeUser = await prisma.user.findUnique({
    where: { id: assigneeUserId },
    select: { name: true, internalRole: true },
  });
  if (!assigneeUser) return { ok: false, message: `用户 ${assigneeUserId} 不存在` };

  if (assigneeUser.internalRole !== expectedInternalRole) {
    return {
      ok: false,
      message: `当前需求处于步骤「${currentStepDef.displayName}」（需要 ${stepRole} 角色），`
        + `但被分配用户「${assigneeUser.name}」的 internalRole 是 ${assigneeUser.internalRole ?? '(未设置)'}，不匹配需求当前步骤的角色要求`,
    };
  }

  return { ok: true };
}
