/**
 * Workflow Helpers — Shared types and utility functions
 *
 * 从 workflow.ts 拆分出来的共享定义和辅助函数
 */
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

// ── Types ────────────────────────────────────────────────

export interface WorkflowStep {
  name: string;
  displayName: string;
  role: string;
  requiredReports: string[];
  autoAdvance: boolean;
  wipLimit?: number; // WIP 上限：该步骤同时处理的需求数量上限（undefined = 无限制）
  assigneeMode?: 'role-based' | 'creator' | 'fixed'; // assignee 解析模式
  // role-based: 从 roleUserMap 查角色对应用户
  // creator: 固定为需求创建者（requesterId）
  // fixed: 保持当前 assignee 不变
}

// ── Helpers ──────────────────────────────────────────────

/** Map user internalRole to workflow step role */
export function mapUserRole(internalRole: string | null | undefined, role: string): string | null {
  if (!internalRole) return null;
  const mapping: Record<string, string[]> = {
    cto: ['cto', 'admin'],
    admin: ['cto', 'admin'],
    backend_developer: ['backend_developer'],
    frontend_developer: ['frontend_developer'],
    mobile_developer: ['mobile_developer'],
    miniapp_developer: ['miniapp_developer'],
    game_developer: ['game_developer'],
    // developer: deprecated — 各具体角色用自己的名称
    tester: ['tester'],
    security: ['security'],
    ops: ['ops'],
    pm: ['pm', 'requester'],
    architect: ['architect'],
    qa: ['qa'],
  };
  const allowed = mapping[internalRole] || [];
  return allowed.includes(role) ? role : null;
}

/** Parse steps from JSONB — 兼容两种格式：
 * 1. 旧格式：纯数组 [...steps]
 * 2. 新格式：{ steps: [...steps], roleUserMap: {...} }
 */
export function parseSteps(stepsJson: unknown): WorkflowStep[] {
  let rawSteps: unknown;

  if (Array.isArray(stepsJson)) {
    // 旧格式：纯数组
    rawSteps = stepsJson;
  } else if (stepsJson && typeof stepsJson === 'object' && 'steps' in stepsJson) {
    // 新格式：{ steps: [...], roleUserMap: {...} }
    rawSteps = (stepsJson as Record<string, unknown>).steps;
  } else {
    rawSteps = [];
  }

  const steps = z.array(z.object({
    name: z.string(),
    displayName: z.string(),
    role: z.string(),
    requiredReports: z.array(z.string()),
    autoAdvance: z.boolean().default(false),
    wipLimit: z.number().int().positive().optional(),
    assigneeMode: z.enum(['role-based', 'creator', 'fixed']).optional(),
  })).parse(rawSteps);
  return steps;
}

/** 从模板 JSON 中提取 roleUserMap（兼容新旧格式） */
export function extractRoleUserMap(stepsJson: unknown): Record<string, string> | undefined {
  if (!stepsJson || typeof stepsJson !== 'object') return undefined;
  if (!Array.isArray(stepsJson) && 'roleUserMap' in stepsJson) {
    return (stepsJson as Record<string, unknown>).roleUserMap as Record<string, string> | undefined;
  }
  return undefined;
}

/** Get current step definition from workflow */
export function getCurrentStep(steps: WorkflowStep[], stepName: string): WorkflowStep | undefined {
  return steps.find(s => s.name === stepName);
}

/** Get next step (or null if at end) */
export function getNextStep(steps: WorkflowStep[], currentStepName: string): WorkflowStep | null {
  const idx = steps.findIndex(s => s.name === currentStepName);
  if (idx === -1 || idx >= steps.length - 1) return null;
  return steps[idx + 1];
}

/** Get previous step (or null if at start) */
export function getPreviousStep(steps: WorkflowStep[], currentStepName: string): WorkflowStep | null {
  const idx = steps.findIndex(s => s.name === currentStepName);
  if (idx <= 0) return null;
  return steps[idx - 1];
}

/** Report types that are self-certifying — only need to exist (pending or approved), not QA-approved */
const SELF_CERTIFY_REPORT_TYPES = new Set([
  'DEV_SELF_CHECK',    // 开发自检：自己检查，不需要别人批准
  'ARCH_DESIGN',       // 架构设计：架构师自审（方案由 arch_review 步骤验证）
  'ARCH_REVIEW',       // 架构审查：架构师审实现，自审自批
  'DEPLOY_CONFIRM',    // 部署确认：部署者确认完成
  'CTO_REVIEW',        // CTO验收：CTO 自审自批
  'MERGE_REPORT',      // 合并报告：合并者自证完成
]);

/** Check if all required reports are in the required status
 *  - Self-certify types (DEV_SELF_CHECK, DEPLOY_CONFIRM): status must be 'pending' or 'approved'
 *  - All other types (TEST_REPORT, SECURITY_REVIEW, CTO_REVIEW, etc.): status must be 'approved'
 */
export async function checkReportsApproved(requirementId: string, requiredReports: string[]): Promise<{ ok: boolean; missing: string[] }> {
  if (requiredReports.length === 0) return { ok: true, missing: [] };

  const selfCertify = requiredReports.filter(t => SELF_CERTIFY_REPORT_TYPES.has(t as string));
  const needApproval = requiredReports.filter(t => !SELF_CERTIFY_REPORT_TYPES.has(t as string));

  const missing: string[] = [];

  // Self-certify types: pending (submitted) or approved is fine
  if (selfCertify.length > 0) {
    const found = await prisma.requirementReport.findMany({
      where: {
        requirementId,
        reportType: { in: selfCertify as any },
        status: { in: ['pending', 'approved'] },
      },
      select: { reportType: true },
    });
    const foundTypes = new Set(found.map(r => r.reportType));
    for (const t of selfCertify) {
      if (!foundTypes.has(t as any)) missing.push(t);
    }
  }

  // Non-self-certify types: must be approved
  if (needApproval.length > 0) {
    const approved = await prisma.requirementReport.findMany({
      where: {
        requirementId,
        reportType: { in: needApproval as any },
        status: 'approved',
      },
      select: { reportType: true },
    });
    const approvedTypes = new Set(approved.map(r => r.reportType));
    for (const t of needApproval) {
      if (!approvedTypes.has(t as any)) missing.push(t);
    }
  }

  return { ok: missing.length === 0, missing };
}

/** Check WIP limit for a step — returns current count of requirements sitting at that step */
export async function getStepWipCount(stepName: string, excludeRequirementId?: string): Promise<number> {
  const where: any = { currentStep: stepName };
  if (excludeRequirementId) {
    where.id = { not: excludeRequirementId };
  }
  return prisma.requirement.count({ where });
}

/** Write audit transition log */
export async function logTransition(params: {
  requirementId: string;
  fromStep: string;
  toStep: string;
  action: string;
  actorId: string | undefined;
  actorName: string;
  actorRole: string;
  comment?: string;
  metadata?: any;
}) {
  return prisma.workflowTransition.create({
    data: {
      requirementId: params.requirementId,
      fromStep: params.fromStep,
      toStep: params.toStep,
      action: params.action,
      actorId: params.actorId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      comment: params.comment,
      metadata: params.metadata ?? undefined,
    },
  });
}
