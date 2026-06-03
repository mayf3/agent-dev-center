/**
 * 自动催办 Cron — 检查超时需求并通知
 *
 * 规则：
 * 1. approved 超 12h 未变 in-progress → 通知 assignee
 * 2. in-progress 超 48h 无新 commit/reports → 通知 assignee + CTO
 *
 * 判断依据：
 * - 需求 status 变更时间通过 RequirementReport 的 createdAt 推断
 * - 有新 commit = gitHash 字段非空且 updatedAt 较新
 * - 有新 reports = 最近 48h 有 report 提交
 */

import { prisma } from '../lib/prisma.js';
import { notifyEvent } from '../utils/notifications.js';

const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

interface OverdueItem {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  assigneeId: string | null;
  approvedAt: Date | null;
  lastActivityAt: Date;
  stalledHours: number;
}

/**
 * 查找超时需求
 */
export async function findOverdueRequirements(): Promise<{
  notStarted: OverdueItem[];
  stalled: OverdueItem[];
}> {
  const now = new Date();

  // 获取所有 approved 和 in-progress 需求
  const requirements = await prisma.requirement.findMany({
    where: {
      currentStep: { in: ['dev_self_check', 'test_env_deploy', 'testing', 'security_review', 'cto_review', 'deploying'] },
    },
    include: {
      reports: {
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { createdAt: true, reportType: true },
      },
    },
  });

  const notStarted: OverdueItem[] = [];
  const stalled: OverdueItem[] = [];

  for (const req of requirements) {
    // 推算 approved 时间：找最近的 status 变更到 approved 的 report
    const approvedReport = req.reports.find((r: { createdAt: Date; reportType: string }) => r.reportType === 'CTO_REVIEW');
    // approved 时间 = 最后 CTO_REVIEW 时间 或 updatedAt
    const approvedAt = approvedReport?.createdAt ?? req.updatedAt;

    // 最后活动时间 = 最新 report 或 updatedAt
    const lastReportAt = req.reports[0]?.createdAt ?? null;
    const lastActivityAt = new Date(
      Math.max(
        req.updatedAt.getTime(),
        lastReportAt ? lastReportAt.getTime() : 0,
        approvedAt.getTime(),
      ),
    );

    const stalledMs = now.getTime() - lastActivityAt.getTime();
    const stalledHours = Math.round(stalledMs / (60 * 60 * 1000));

    const step = req.currentStep || 'unknown';
    if (step === 'dev_self_check' || step === 'test_env_deploy') {
      // 开发步骤超 48h 无活动
      if (stalledMs > FORTY_EIGHT_HOURS) {
        notStarted.push({
          id: req.id,
          title: req.title,
          status: step,
          assignee: req.assignee,
          assigneeId: req.assigneeId,
          approvedAt: null,
          lastActivityAt,
          stalledHours,
        });
      }
    } else if (step === 'testing' || step === 'security_review') {
      // in-progress 超 48h 无活动
      if (stalledMs > FORTY_EIGHT_HOURS) {
        stalled.push({
          id: req.id,
          title: req.title,
          status: step,
          assignee: req.assignee,
          assigneeId: req.assigneeId,
          approvedAt,
          lastActivityAt,
          stalledHours,
        });
      }
    }
  }

  return { notStarted, stalled };
}

/**
 * 发送催办通知
 */
export async function sendOverdueNotifications(): Promise<{
  notStartedCount: number;
  stalledCount: number;
}> {
  const { notStarted, stalled } = await findOverdueRequirements();

  for (const item of notStarted) {
    void notifyEvent('requirement.overdue.not_started' as any, {
      id: item.id,
      title: item.title,
      assignee: item.assignee,
      stalledHours: item.stalledHours,
      message: `需求「${item.title}」已批准 ${item.stalledHours}h，尚未开始开发`,
    });
  }

  for (const item of stalled) {
    void notifyEvent('requirement.overdue.stalled' as any, {
      id: item.id,
      title: item.title,
      assignee: item.assignee,
      stalledHours: item.stalledHours,
      message: `需求「${item.title}」进行中已停滞 ${item.stalledHours}h，无新提交`,
    });
  }

  return {
    notStartedCount: notStarted.length,
    stalledCount: stalled.length,
  };
}

/**
 * 手动触发催办检查（供 API 调用）
 */
export async function runOverdueCheck() {
  return sendOverdueNotifications();
}
