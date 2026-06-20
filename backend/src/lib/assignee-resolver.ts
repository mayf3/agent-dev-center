/**
 * Assignee Resolver — 工作流步骤角色 → 用户自动映射
 *
 * 核心原则：
 * - assigneeId 是唯一的真实字段（FK → users.id）
 * - assignee 文本字段废弃，API 输出通过 JOIN assigneeUser.name 获取
 * - 工作流 advance/reject 时自动查找下一步骤 role 对应的用户
 */
import { prisma } from './prisma.js';
import { getWorkflowSteps } from '../routes/requirements/workflow-helpers.js';

/**
 * Minimal user lookup interface — accepts any Prisma client (extended or plain)
 * that provides user.findUnique / user.findFirst.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AssigneeResolverDb = any;

/** 工作流步骤 role → InternalRole 映射 */
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
  qa: 'qa',  // 2026-06-05 新增 QA 步骤支持
  architect: 'architect',  // 2026-06-13 架构师独立角色
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
  db?: AssigneeResolverDb,
): Promise<string | null> {
  const client = db ?? prisma;
  // requester 角色：返回当前 assignee（需求创建者），不查找 internalRole
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

  // 兜底：找不到匹配用户时分配给 CTO（避免 assignee 为空导致任务无人处理）
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
 * 如果需求有工作流，assigneeId 指向的用户必须拥有目标步骤所需的 internalRole。
 *
 * 2026-06-14 修复 (fe6d34b5): 当步骤发生变更时（PM 打回 draft），应使用
 * targetStep 的 role 校验 assignee，而非 currentStep 的 role。
 * 例：pm_review→draft，PM 设 assignee=requester，应校验 draft 的 role(requester)
 * 而非 pm_review 的 role(pm)。
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
    select: { workflowId: true, currentStep: true, workflowSnapshot: true },
  });
  if (!requirement?.workflowId || !requirement.currentStep) return { ok: true };

  // Kernel Phase 2A: prefer workflowSnapshot over live template
  let rawSteps: unknown;
  if (requirement.workflowSnapshot !== null) {
    rawSteps = requirement.workflowSnapshot;
  } else {
    // Legacy fallback: no snapshot → read from live template
    const template = await prisma.workflowTemplate.findFirst({
      where: { id: requirement.workflowId, isActive: true },
      select: { steps: true },
    });
    if (!template) return { ok: true };
    rawSteps = template.steps;
  }

  // Parse steps using the snapshot helper (supports array and {steps: array} forms)
  let steps: Array<{ name: string; role: string; displayName: string }>;
  try {
    steps = getWorkflowSteps(rawSteps) as any;
  } catch {
    return { ok: true };
  }

  // 确定用于校验的步骤：优先 targetStepName（步骤变更场景），否则用 currentStep
  const stepForValidation = targetStepName ?? requirement.currentStep;
  const stepDef = steps.find(s => s.name === stepForValidation);
  if (!stepDef) return { ok: true };

  const stepRole = stepDef.role;

  // 特殊处理：requester 角色不校验 internalRole（draft 步骤的 assignee 应为需求创建者）
  // 任何人可以是 requester，跟 internalRole 无关
  if (stepRole === 'requester') return { ok: true };

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
      message: `步骤「${stepDef.displayName}」（需要 ${stepRole} 角色），`
        + `但被分配用户「${assigneeUser.name}」的 internalRole 是 ${assigneeUser.internalRole ?? '(未设置)'}，不匹配该步骤的角色要求`,
    };
  }

  return { ok: true };
}
