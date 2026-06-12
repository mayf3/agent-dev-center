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
    qa: ['qa'],
  };
  const allowed = mapping[internalRole] || [];
  return allowed.includes(role) ? role : null;
}

/** Parse steps from JSONB */
export function parseSteps(stepsJson: unknown): WorkflowStep[] {
  const steps = z.array(z.object({
    name: z.string(),
    displayName: z.string(),
    role: z.string(),
    requiredReports: z.array(z.string()),
    autoAdvance: z.boolean().default(false),
    wipLimit: z.number().int().positive().optional(),
  })).parse(stepsJson);
  return steps;
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

/** Check if all required reports are approved */
export async function checkReportsApproved(requirementId: string, requiredReports: string[]): Promise<{ ok: boolean; missing: string[] }> {
  if (requiredReports.length === 0) return { ok: true, missing: [] };

  const approvedReports = await prisma.requirementReport.findMany({
    where: {
      requirementId,
      reportType: { in: requiredReports as any },
      status: 'approved',  // 2026-06-10: 只认 approved，pending 不算通过（防止报告提交=审批通过）
    },
    select: { reportType: true },
  });

  const approvedTypes = new Set(approvedReports.map(r => r.reportType));
  const missing = requiredReports.filter(t => !approvedTypes.has(t as any));

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
