/**
 * Dashboard Routes — CTO 反馈聚合仪表盘
 *
 * GET /api/dashboard/feedback — 反馈聚合数据
 *   Query: period (7d|30d|all), requirementId (optional)
 *
 * 数据来源：feedback_events + workflow_transitions
 * 返回：rejectRate, trend, topRootCauses, byStep
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { authRequired } from '../middleware/auth.js';
import { HttpError } from '../utils/http-error.js';
import { z } from 'zod';

export const dashboardRouter = Router();

dashboardRouter.use(authRequired);

dashboardRouter.use((req, _res, next) => {
  // 仅 admin/cto 可访问仪表盘
  const isAuthed = req.user?.role === 'admin' || req.user?.internalRole === 'cto';
  if (!isAuthed) {
    next(new HttpError(403, '仅 CTO/Admin 可访问仪表盘'));
    return;
  }
  next();
});

const dashboardQuerySchema = z.object({
  query: z.object({
    period: z.enum(['7d', '30d', 'all']).default('7d'),
    requirementId: z.string().uuid().optional(),
  }),
});

/**
 * GET /api/dashboard/feedback — 反馈聚合数据
 *
 * 返回结构：
 * {
 *   success: true,
 *   data: {
 *     summary: { totalRejects, totalAdvances, rejectRate },
 *     trend: [{ date, rejects, advances }],
 *     topRootCauses: [{ reason, count }],
 *     byStep: [{ step, rejects, totalTransitions }]
 *   }
 * }
 */
dashboardRouter.get(
  '/feedback',
  asyncHandler(async (req, res) => {
    const { query } = dashboardQuerySchema.parse({ query: req.query });

    // 计算时间范围
    const now = new Date();
    let since = new Date(0); // epoch = all time
    if (query.period === '7d') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (query.period === '30d') {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // 构建公共 where 条件
    const feedbackWhere: any = { createdAt: { gte: since } };
    if (query.requirementId) {
      feedbackWhere.requirementId = query.requirementId;
    }

    const transitionWhere: any = { createdAt: { gte: since } };
    if (query.requirementId) {
      transitionWhere.requirementId = query.requirementId;
    }

    // 1. 汇总：总 reject 数、总 advance 数、reject 率
    const [totalRejects, totalAdvances] = await Promise.all([
      prisma.workflowTransition.count({
        where: { ...transitionWhere, action: 'reject' },
      }),
      prisma.workflowTransition.count({
        where: { ...transitionWhere, action: 'advance' },
      }),
    ]);

    const totalTransitions = totalRejects + totalAdvances;
    const rejectRate = totalTransitions > 0
      ? Number(((totalRejects / totalTransitions) * 100).toFixed(1))
      : 0;

    // 2. 趋势：按天分组的 reject/advance 数
    const trendRaw = await prisma.workflowTransition.groupBy({
      by: ['action'],
      _count: true,
      where: transitionWhere,
    });

    // Prisma 不支持按日期分组，使用 raw SQL
    const periodDays = query.period === '7d' ? 7 : query.period === '30d' ? 30 : 365;
    const trendSql = `
      SELECT
        DATE("createdAt") as date,
        action,
        COUNT(*)::int as count
      FROM workflow_transitions
      WHERE "createdAt" >= $1
        ${query.requirementId ? 'AND "requirementId" = $2' : ''}
      GROUP BY DATE("createdAt"), action
      ORDER BY DATE("createdAt") ASC
    `;
    const trendParams: any[] = [since];
    if (query.requirementId) trendParams.push(query.requirementId);

    const trendRows = await prisma.$queryRawUnsafe(trendSql, ...trendParams) as any[];

    // Build trend array
    const trendMap = new Map<string, { date: string; rejects: number; advances: number }>();
    for (const row of trendRows) {
      const dateStr = typeof row.date === 'string' ? row.date : row.date.toISOString().slice(0, 10);
      if (!trendMap.has(dateStr)) {
        trendMap.set(dateStr, { date: dateStr, rejects: 0, advances: 0 });
      }
      const entry = trendMap.get(dateStr)!;
      if (row.action === 'reject') entry.rejects = row.count;
      if (row.action === 'advance') entry.advances = row.count;
    }
    const trend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // 3. 根因分析 Top 5：最常见的 reject comment
    const topCausesSql = `
      SELECT
        COALESCE(NULLIF(TRIM(comment), ''), '未填写原因') as reason,
        COUNT(*)::int as count
      FROM workflow_transitions
      WHERE action = 'reject'
        AND "createdAt" >= $1
        ${query.requirementId ? 'AND "requirementId" = $2' : ''}
      GROUP BY COALESCE(NULLIF(TRIM(comment), ''), '未填写原因')
      ORDER BY count DESC
      LIMIT 5
    `;
    const topCausesParams: any[] = [since];
    if (query.requirementId) topCausesParams.push(query.requirementId);

    const topRootCauses = await prisma.$queryRawUnsafe(topCausesSql, ...topCausesParams) as any[];

    // 4. 按步骤分组的 reject 率
    const byStepSql = `
      SELECT
        "fromStep" as step,
        action,
        COUNT(*)::int as count
      FROM workflow_transitions
      WHERE "createdAt" >= $1
        ${query.requirementId ? 'AND "requirementId" = $2' : ''}
      GROUP BY "fromStep", action
      ORDER BY "fromStep"
    `;
    const byStepParams: any[] = [since];
    if (query.requirementId) byStepParams.push(query.requirementId);

    const byStepRows = await prisma.$queryRawUnsafe(byStepSql, ...byStepParams) as any[];

    // Aggregate by step
    const stepMap = new Map<string, { step: string; rejects: number; total: number }>();
    for (const row of byStepRows) {
      if (!stepMap.has(row.step)) {
        stepMap.set(row.step, { step: row.step, rejects: 0, total: 0 });
      }
      const entry = stepMap.get(row.step)!;
      entry.total += row.count;
      if (row.action === 'reject') entry.rejects = row.count;
    }
    const byStep = Array.from(stepMap.values()).map(s => ({
      ...s,
      rejectRate: s.total > 0 ? Number(((s.rejects / s.total) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.rejectRate - a.rejectRate);

    // 5. Feedback events 统计（使用 raw SQL 避免类型依赖）
    let feedbackStats: any = null;
    try {
      const feedbackSql = `
        SELECT
          "fromStep",
          COUNT(*)::int as count
        FROM feedback_events
        WHERE "createdAt" >= $1
          ${query.requirementId ? 'AND "requirementId" = $2' : ''}
        GROUP BY "fromStep"
        ORDER BY count DESC
      `;
      const feedbackParams: any[] = [since];
      if (query.requirementId) feedbackParams.push(query.requirementId);
      const feedbackRows = await prisma.$queryRawUnsafe(feedbackSql, ...feedbackParams) as any[];
      const totalFeedback = feedbackRows.reduce((sum, r) => sum + r.count, 0);
      feedbackStats = { total: totalFeedback, byStep: feedbackRows };
    } catch {
      feedbackStats = { total: 0, byStep: [], note: 'feedback_events 表尚未部署' };
    }

    res.json({
      success: true,
      data: {
        summary: {
          totalRejects,
          totalAdvances,
          totalTransitions,
          rejectRate,
          period: query.period,
        },
        trend,
        topRootCauses: topRootCauses.map(r => ({
          reason: r.reason,
          count: r.count,
        })),
        byStep,
        feedbackEvents: feedbackStats,
      },
    });
  }),
);

export const router = dashboardRouter;
export const mountPath = '/api/dashboard';
