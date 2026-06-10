/**
 * report-config.ts (228e1deb: 从 reports.ts 拆分)
 * 报告类型权限配置 + 角色校验辅助函数
 */
import { ReportType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { getPlatformRoles, hasPlatformRole, isPlatformAdmin } from '../lib/platform-roles.js';

/**
 * 报告类型 → 允许提交的角色/身份映射
 *
 * ⚠️ 2026-05-21 验尸修复：废除 admin 万能豁免
 *
 * - DEV_SELF_CHECK → 需求 assignee 可提
 * - TEST_REPORT → 仅 adc:tester 可提
 * - SECURITY_REVIEW → 仅 adc:security 可提
 * - CTO_REVIEW → 仅 adc:admin 可提
 * - DEPLOY_CONFIRM → 仅 adc:ops 可提
 * - POSTMORTEM → 任何认证用户可提
 * - ⛔ admin 不能代提交任何报告（allowAdmin: 已废除）
 */
export const REPORT_ROLE_MAP: Record<string, { mode: 'assignee' | 'role' | 'any'; platformRoles?: string[]; allowAdmin?: boolean }> = {
  DEV_SELF_CHECK:    { mode: 'assignee', allowAdmin: false },
  TEST_REPORT:       { mode: 'role', platformRoles: ['adc:tester'], allowAdmin: false },
  SECURITY_REVIEW:   { mode: 'role', platformRoles: ['adc:security'], allowAdmin: false },
  CTO_REVIEW:        { mode: 'role', platformRoles: ['adc:admin'], allowAdmin: true },
  DEPLOY_CONFIRM:    { mode: 'role', platformRoles: ['adc:ops'], allowAdmin: false },
  POSTMORTEM:        { mode: 'any', allowAdmin: true },
};

export const QA_BYPASS_MIN_WAIT_MS = 2 * 60 * 60 * 1000;

export const WORKFLOW_STEP_PLATFORM_ROLES: Record<string, string[]> = {
  cto: ['adc:admin'],
  admin: ['adc:admin'],
  developer: ['adc:developer'],
  tester: ['adc:tester'],
  security: ['adc:security'],
  ops: ['adc:ops'],
  pm: ['adc:pm', 'adc:viewer'],
  requester: ['adc:pm', 'adc:viewer'],
};

export function describeUserRoles(user: Express.AuthUser): string {
  return getPlatformRoles(user).join(', ') || user.internalRole || user.role;
}

export function hasWorkflowStepRole(user: Express.AuthUser, stepRole: string): boolean {
  const platformRoles = WORKFLOW_STEP_PLATFORM_ROLES[stepRole] ?? [];
  return platformRoles.some(role => hasPlatformRole(user, role));
}

/**
 * 校验提交者是否有权提交该类型的报告
 * ⚠️ 2026-05-21 验尸修复：废除 admin 万能豁免 + 改用 internal_role 校验
 */
export async function validateReportRole(
  user: Express.AuthUser,
  reportType: string,
  requirementId: string,
): Promise<void> {
  const rule = REPORT_ROLE_MAP[reportType];
  if (!rule) return;

  const isAdminEnv = isPlatformAdmin(user);

  if (isAdminEnv && rule.allowAdmin) {
    if (rule.mode === 'assignee') {
      throw new HttpError(403, `⛔ ${reportType} 仅需求 assignee 可提交，admin 不能代提交`);
    }
    if (rule.platformRoles && rule.platformRoles.length > 0 && !rule.platformRoles.includes('adc:admin')) {
      throw new HttpError(403, `⛔ ${reportType} 仅 ${rule.platformRoles.join('/')} 可提交，admin 不能代提交`);
    }
    return;
  }

  if (isAdminEnv && !rule.allowAdmin) {
    throw new HttpError(403, `⛔ admin 不能提交 ${reportType} 报告，请使用对应角色的 ADC 账号自行提交`);
  }

  if (rule.mode === 'role' && rule.platformRoles && rule.platformRoles.length > 0) {
    if (rule.platformRoles.some(role => hasPlatformRole(user, role))) return;
    const allowed = rule.platformRoles.map(r => `role=${r}`).join(' 或 ');
    throw new HttpError(403, `${reportType} 报告仅 ${allowed} 可提交（你的角色: ${describeUserRoles(user)}）`);
  }

  if (rule.mode === 'any') return;

  if (rule.mode === 'assignee') {
    const requirement = await prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { assignee: true, assigneeId: true, requesterId: true },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const userId = user.id;
    const userName = user.name || '';

    const isAssignee = userId === requirement.assigneeId || userName === requirement.assignee;
    if (!isAssignee) {
      throw new HttpError(403, `DEV_SELF_CHECK 仅需求 assignee 可提交，当前 assignee: ${requirement.assignee || '未分配'}`);
    }
  }
}
