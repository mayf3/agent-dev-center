import { HttpError } from '../../utils/http-error.js';

// ─── OKR Permission helpers (68e8ceed) ─────────────────────

export function canEditGoals(okrRole: string | null | undefined): boolean {
  return okrRole === 'okr_admin' || okrRole === 'okr_reviewer' || okrRole === 'okr_owner';
}

export function requireOkrEdit(req: any, _res: any, next: any): void {
  const okrRole = req.user?.okrRole;
  if (!canEditGoals(okrRole)) {
    throw new HttpError(403, '需要 okr_admin / okr_reviewer / okr_owner 权限才能操作目标卡');
  }
  next();
}

// ─── Types ──────────────────────────────────────────────────

export interface MonthlyGoal {
  text: string;
  status: 'not_started' | 'in_progress' | 'done';
}

export interface MonthlyGoalGroup {
  month: string; // "2026-05"
  goals: MonthlyGoal[];
}

// ─── Helper: parse JSON monthlyGoals ────────────────────────

export function parseMonthlyGoals(val: unknown): MonthlyGoalGroup[] {
  return (val as MonthlyGoalGroup[]) || [];
}

// ─── UUID regex ─────────────────────────────────────────────

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Pipeline normalization ─────────────────────────────────

/**
 * Acceptable public pipeline values for goal card creation/update.
 */
const PUBLIC_PIPELINE_VALUES = [
  'content', 'parenting', 'investment', 'health', 'planning',
  'lifestyle', 'devops', 'education', 'business',
  'cross-cutting', 'cross_cutting',
] as const;

/**
 * Normalize a pipeline value from the public API to a Prisma-compatible PipelineName.
 *
 * Both "cross-cutting" (hyphen) and "cross_cutting" (underscore)
 * are mapped to "cross_cutting". All other valid values are passed through
 * as-is. Invalid values throw 400.
 *
 * The return type uses the PipelineName enum string union, which matches
 * what Prisma expects for the pipeline field on AgentGoalCard.
 */
export function normalizePipeline(value: unknown): 'content' | 'parenting' | 'investment' | 'health' | 'planning' | 'lifestyle' | 'devops' | 'education' | 'business' | 'cross_cutting' {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'pipeline 必须是字符串');
  }

  const trimmed = value.trim();

  // Accept both hyphen and underscore variants for cross-cutting
  if (trimmed === 'cross-cutting' || trimmed === 'cross_cutting') {
    return 'cross_cutting';
  }

  // All other valid enum values — direct match to Prisma PipelineName members
  const directValues = [
    'content', 'parenting', 'investment', 'health', 'planning',
    'lifestyle', 'devops', 'education', 'business',
  ] as const;
  // TypeScript const assertion preserves literal types for the includes check
  if ((directValues as readonly string[]).includes(trimmed)) {
    return trimmed as 'content' | 'parenting' | 'investment' | 'health' | 'planning' | 'lifestyle' | 'devops' | 'education' | 'business' | 'cross_cutting';
  }

  throw new HttpError(400, `无效的 pipeline 值: "${value}"。有效值: ${PUBLIC_PIPELINE_VALUES.join(', ')}`);
}

// ─── Helper: resolve agentId (UUID or name) to marketplaceAgent ───

import { prisma } from '../../lib/prisma.js';

export async function resolveAgentParam(param: string): Promise<{ id: string; name: string }> {
  if (UUID_REGEX.test(param)) {
    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: param },
      select: { id: true, name: true },
    });
    if (agent) return agent;
  }

  const agent = await prisma.marketplaceAgent.findFirst({
    where: { name: { equals: param, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!agent) {
    throw new HttpError(404, `Agent 不存在: "${param}"`);
  }
  return agent;
}
