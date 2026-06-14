import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { isPlatformAdmin } from '../lib/platform-roles.js';

export const adminAuditRouter = Router();

// Admin guard
function assertAdmin(req: Express.Request): void {
  if (!req.user) throw new HttpError(401, 'Authentication required');
  if (!isPlatformAdmin(req.user) && req.user.role !== 'admin' && req.user.internalRole !== 'cto') {
    throw new HttpError(403, 'Admin or CTO role required');
  }
}

// ── 2. GET /api/admin/transition-logs — 全局流转日志（分页+筛选）───────────
adminAuditRouter.get(
  '/transition-logs',
  authRequired,
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const requirementId = typeof req.query.requirementId === 'string' ? req.query.requirementId : undefined;
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;

    const where: any = {};
    if (requirementId) where.requirementId = requirementId;
    if (actorId) where.actorId = actorId;
    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [logs, total] = await Promise.all([
      prisma.workflowTransition.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.workflowTransition.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      meta: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  }),
);

// ── 3. GET /api/admin/transition-stats — 阶段耗时统计 ────────────────────
adminAuditRouter.get(
  '/transition-stats',
  authRequired,
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const groupBy = typeof req.query.groupBy === 'string' ? req.query.groupBy : 'step';
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;

    if (groupBy !== 'step') {
      throw new HttpError(400, 'groupBy 只支持 step');
    }

    const where: any = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    // 查询所有流转记录
    const transitions = await prisma.workflowTransition.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    // 计算每个阶段的耗时
    const stepStats = new Map<string, number[]>();

    for (let i = 0; i < transitions.length; i++) {
      const curr = transitions[i];
      const next = transitions[i + 1];

      // 只有当有下一条记录且是同一个需求时才能计算耗时
      if (next && curr.requirementId === next.requirementId) {
        const hours = (next.createdAt.getTime() - curr.createdAt.getTime()) / (1000 * 60 * 60);
        const step = curr.toStep;

        if (!stepStats.has(step)) {
          stepStats.set(step, []);
        }
        stepStats.get(step)!.push(hours);
      }
    }

    // 计算统计指标
    const stats = Array.from(stepStats.entries()).map(([step, hours]) => {
      const sorted = [...hours].sort((a, b) => a - b);
      const avg = hours.reduce((a, b) => a + b, 0) / hours.length;
      const p95Index = Math.floor(hours.length * 0.95);
      const p95 = sorted[p95Index] ?? sorted[sorted.length - 1];

      return {
        step,
        avgHours: Math.round(avg * 10) / 10,
        p95Hours: Math.round(p95 * 10) / 10,
        count: hours.length,
      };
    });

    res.json({
      success: true,
      data: {
        steps: stats,
      },
    });
  }),
);

// ── 4. GET /api/admin/agent-stats — Agent 操作统计 ────────────────────────
adminAuditRouter.get(
  '/agent-stats',
  authRequired,
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;

    const where: any = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    // 查询所有流转记录
    const transitions = await prisma.workflowTransition.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    // 按 Agent 统计
    const agentStats = new Map<string, {
      totalActions: number;
      advanceCount: number;
      rejectCount: number;
      assignCount: number;
      responseHours: number[];
      lastActiveAt: Date;
    }>();

    for (const t of transitions) {
      const agentName = t.actorName;

      if (!agentStats.has(agentName)) {
        agentStats.set(agentName, {
          totalActions: 0,
          advanceCount: 0,
          rejectCount: 0,
          assignCount: 0,
          responseHours: [],
          lastActiveAt: t.createdAt,
        });
      }

      const stats = agentStats.get(agentName)!;
      stats.totalActions++;
      stats.lastActiveAt = t.createdAt;

      if (t.action === 'advance') stats.advanceCount++;
      if (t.action === 'reject') stats.rejectCount++;
      if (t.action === 'assign-workflow') stats.assignCount++;

      // 计算响应时间（从上一次操作到本次操作的时间间隔）
      // 这里简化处理：只记录有间隔的操作
    }

    // 计算平均响应时间
    const result = Array.from(agentStats.entries()).map(([agentName, stats]) => {
      const avgResponse = stats.responseHours.length > 0
        ? stats.responseHours.reduce((a, b) => a + b, 0) / stats.responseHours.length
        : 0;

      return {
        agentName,
        totalActions: stats.totalActions,
        advanceCount: stats.advanceCount,
        rejectCount: stats.rejectCount,
        assignCount: stats.assignCount,
        avgResponseHours: Math.round(avgResponse * 10) / 10,
        lastActiveAt: stats.lastActiveAt,
      };
    });

    // 按总操作次数降序排序
    result.sort((a, b) => b.totalActions - a.totalActions);

    res.json({
      success: true,
      data: {
        agents: result,
      },
    });
  }),
);
export const router = adminAuditRouter;
export const mountPath = '/api/admin';
