/**
 * Assignee Resolver — 工作流步骤角色 → 用户自动映射
 *
 * 核心原则：
 * - assigneeId 是唯一的真实字段（FK → users.id）
 * - assignee 文本字段废弃，API 输出通过 JOIN assigneeUser.name 获取
 * - 工作流 advance/reject 时自动查找下一步骤 role 对应的用户
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
};

/**
 * 根据工作流步骤的 role 找到对应的用户 ID
 *
 * 优先级：
 * 1. 如果传入 currentAssigneeId 且该用户的 internalRole 匹配 → 保持不变
 * 2. 从 users 表找 internalRole 匹配的第一个活跃用户
 */
export async function resolveAssigneeForStep(
  stepRole: string,
  currentAssigneeId?: string | null,
): Promise<string | null> {
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
    select: { id: true },
  });

  return match?.id ?? null;
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
 * 通过名字或邮箱查找 assigneeId（API 输入兼容）
 * 支持 name / email / userId 三种输入
 */
export async function resolveAssigneeId(input: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { name: input },
        { email: input },
        { id: input },
      ],
    },
    select: { id: true },
  });
  return user?.id ?? null;
}
