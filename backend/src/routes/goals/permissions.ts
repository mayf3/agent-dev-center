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
