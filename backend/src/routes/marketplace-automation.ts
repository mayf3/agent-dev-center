import { Prisma, MarketplaceAgentStatus } from '@prisma/client';
import { randomUUID, randomBytes } from 'crypto';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { agentTokenRequired } from '../middleware/marketplace-auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { notifyAgentNewTask } from '../utils/marketplace-notify.js';
import {
  registerAgentSchema,
  taskCallbackSchema,
  heartbeatSchema,
  rankingsSchema,
} from '../schemas/marketplace-automation.js';

export const marketplaceAutomationRouter = Router();

// ─── Agent Token 生成 ──────────────────────────────────────────

function generateAgentToken(): string {
  const random = randomBytes(32).toString('hex');
  return `agent_${random}`;
}

// ─── 1. 能力自动注册 ───────────────────────────────────────────

/**
 * POST /api/marketplace/agents/register
 *
 * Agent 启动时调用。如果 name 已存在则更新，首次创建时返回 agentToken。
 * 认证方式：首次调用无需 token（创建后返回 token），后续调用需要 Agent token。
 */
marketplaceAutomationRouter.post(
  '/agents/register',
  asyncHandler(async (req, res) => {
    const { body } = registerAgentSchema.parse({ body: req.body });

    // 检查是否已存在
    const existing = await prisma.marketplaceAgent.findUnique({
      where: { name: body.name },
      select: { id: true, agentToken: true },
    });

    // 如果已存在且有 token，需要验证
    let agentId: string;

    if (existing) {
      // 尝试 Agent token 认证
      const authToken = req.header('authorization')?.replace(/^Bearer\s+/i, '');
      const validToken = authToken && (await prisma.agentAccessToken.findFirst({
        where: { token: authToken, agentId: existing.id },
      }));

      if (existing.agentToken && !validToken) {
        throw new HttpError(403, 'Agent 已注册，请使用原有 Token 认证');
      }

      // 更新
      const agent = await prisma.marketplaceAgent.update({
        where: { id: existing.id },
        data: {
          displayName: body.displayName,
          description: body.description,
          avatar: body.avatar || undefined,
          capabilities: body.capabilities as Prisma.InputJsonValue,
          apiEndpoint: body.apiEndpoint || undefined,
          notificationType: body.notificationType,
          feishuWebhookUrl: body.feishuWebhookUrl || undefined,
          tags: body.tags,
          status: MarketplaceAgentStatus.active,
        },
        include: {
          accessTokens: { select: { id: true, token: true, name: true } },
        },
      });

      res.json({
        data: agent,
        token: authToken,
        message: 'Agent 信息已更新',
      });
      return;
    }

    // 首次注册：创建 Agent + 生成 token
    const agent = await prisma.marketplaceAgent.create({
      data: {
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        avatar: body.avatar,
        capabilities: body.capabilities as Prisma.InputJsonValue,
        apiEndpoint: body.apiEndpoint,
        notificationType: body.notificationType,
        feishuWebhookUrl: body.feishuWebhookUrl || undefined,
        tags: body.tags,
        status: MarketplaceAgentStatus.active,
        agentToken: '', // placeholder, will update
      },
    });

    // 生成并存储 token
    const rawToken = generateAgentToken();
    const accessToken = await prisma.agentAccessToken.create({
      data: {
        agentId: agent.id,
        token: rawToken,
        name: 'default',
      },
    });

    // 更新 agent 上的 agentToken 字段
    await prisma.marketplaceAgent.update({
      where: { id: agent.id },
      data: { agentToken: rawToken },
    });

    res.status(201).json({
      data: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        status: agent.status,
      },
      token: rawToken,
      message: 'Agent 注册成功，请妥善保管 Token',
    });
  })
);

// ─── 2. 心跳 ────────────────────────────────────────────────────

/**
 * POST /api/marketplace/heartbeat
 *
 * Agent 定期发送心跳（建议 30 秒一次）。
 * 5 分钟无心跳标记为 offline。
 */
marketplaceAutomationRouter.post(
  '/heartbeat',
  agentTokenRequired,
  asyncHandler(async (req, res) => {
    const { body } = heartbeatSchema.parse({ body: req.body });
    const agentId = req.agentAuth!.agentId;

    await prisma.marketplaceAgent.update({
      where: { id: agentId },
      data: {
        lastHeartbeatAt: new Date(),
        status: body.status === 'busy' ? MarketplaceAgentStatus.active : MarketplaceAgentStatus.active,
      },
    });

    res.json({ ok: true, timestamp: new Date().toISOString(), agentId });
  })
);

// ─── 3. 任务回调 ────────────────────────────────────────────────

/**
 * POST /api/marketplace/tasks/:id/callback
 *
 * Agent 完成任务后调用此接口提交结果。
 */
marketplaceAutomationRouter.post(
  '/tasks/:id/callback',
  agentTokenRequired,
  asyncHandler(async (req, res) => {
    const { params, body } = taskCallbackSchema.parse({
      params: req.params,
      body: req.body,
    });

    const agentId = req.agentAuth!.agentId;

    // 验证任务是本 Agent 的
    const task = await prisma.marketplaceTask.findUnique({
      where: { id: params.id },
      include: { agent: { select: { id: true, name: true } } },
    });

    if (!task) throw new HttpError(404, '任务不存在');
    if (task.agentId !== agentId) throw new HttpError(403, '无权操作其他 Agent 的任务');
    if (task.status === 'completed' || task.status === 'failed') {
      throw new HttpError(409, `任务已结束（${task.status}），无法重复回调`);
    }

    // 更新任务
    const updatedTask = await prisma.$transaction(async (tx) => {
      // 创建交付物
      if (body.deliverables.length > 0) {
        await tx.marketplaceDeliverable.createMany({
          data: body.deliverables.map((d) => ({
            taskId: params.id,
            type: d.type,
            title: d.title,
            content: d.content,
            metadata: d.metadata as Prisma.InputJsonValue | undefined,
          })),
        });
      }

      // 更新任务状态
      const updateData: Prisma.MarketplaceTaskUpdateInput = {
        status: body.status,
        completedAt: new Date(),
        errorMsg: body.errorMsg || undefined,
      };

      if (body.executionTimeMs) updateData.executionTimeMs = body.executionTimeMs;
      if (body.tokensUsed) updateData.tokensUsed = body.tokensUsed;

      return tx.marketplaceTask.update({
        where: { id: params.id },
        data: updateData,
        include: {
          agent: { select: { id: true, name: true, displayName: true } },
          deliverables: { orderBy: { createdAt: 'desc' } },
        },
      });
    });

    res.json({ data: updatedTask, success: true });
  })
);

// ─── 4. Agent 评分排行 ─────────────────────────────────────────

/**
 * GET /api/marketplace/agents/rankings
 *
 * 根据完成率、耗时、按时率、质量进行综合评分排序。
 */
marketplaceAutomationRouter.get(
  '/agents/rankings',
  asyncHandler(async (req, res) => {
    const { query } = rankingsSchema.parse({ query: req.query });
    const { days, limit } = query;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 获取所有活跃 Agent
    const agents = await prisma.marketplaceAgent.findMany({
      where: { status: { in: ['active', 'maintenance'] } },
      select: {
        id: true,
        name: true,
        displayName: true,
        avatar: true,
        status: true,
      },
    });

    if (agents.length === 0) {
      res.json({ data: [], period: `${days}d`, calculatedAt: new Date().toISOString() });
      return;
    }

    // 批量查询任务统计
    const allStats = await Promise.all(
      agents.map(async (agent) => {
        const total = await prisma.marketplaceTask.count({
          where: { agentId: agent.id, createdAt: { gte: since } },
        });

        const completed = await prisma.marketplaceTask.count({
          where: { agentId: agent.id, status: 'completed', createdAt: { gte: since } },
        });

        const failed = await prisma.marketplaceTask.count({
          where: { agentId: agent.id, status: 'failed', createdAt: { gte: since } },
        });

        // 平均执行时间
        const completedTasks = await prisma.marketplaceTask.findMany({
          where: {
            agentId: agent.id,
            status: 'completed',
            completedAt: { not: null },
            startedAt: { not: null },
            createdAt: { gte: since },
          },
          select: { startedAt: true, completedAt: true, executionTimeMs: true, deadline: true },
        });

        let avgTimeMs = 0;
        let onTimeCount = 0;
        let withDeadline = 0;
        let totalExecMs = 0;

        for (const t of completedTasks) {
          // 执行时间
          if (t.executionTimeMs) {
            totalExecMs += t.executionTimeMs;
          } else if (t.startedAt && t.completedAt) {
            totalExecMs += t.completedAt.getTime() - t.startedAt.getTime();
          }

          // 按时率
          if (t.deadline) {
            withDeadline++;
            if (t.completedAt && t.completedAt <= t.deadline) {
              onTimeCount++;
            }
          }
        }

        avgTimeMs = completedTasks.length > 0 ? totalExecMs / completedTasks.length : 0;

        // 质量分：有交付物的完成任务比例
        const withDeliverable = completed > 0
          ? await prisma.marketplaceTask.count({
              where: {
                agentId: agent.id,
                status: 'completed',
                createdAt: { gte: since },
                deliverables: { some: {} },
              },
            })
          : 0;

        // 计算评分（4 维加权）
        const completionRate = total > 0 ? completed / total : 0;
        const speedScore = total > 0 ? Math.max(0, 1 - avgTimeMs / 3_600_000) : 0.5; // 归一化，3h = 0
        const deadlineRate = withDeadline > 0 ? onTimeCount / withDeadline : 0.5;
        const qualityRate = completed > 0 ? withDeliverable / completed : 0;

        const score = (
          completionRate * 0.4 +
          speedScore * 0.2 +
          deadlineRate * 0.2 +
          qualityRate * 0.2
        ) * 100;

        return {
          agentId: agent.id,
          name: agent.name,
          displayName: agent.displayName,
          avatar: agent.avatar,
          score: Math.round(score * 10) / 10,
          stats: {
            total,
            completed,
            failed,
            avgTimeMs: Math.round(avgTimeMs),
            onTimeRate: withDeadline > 0 ? Math.round((onTimeCount / withDeadline) * 100) / 100 : 0,
            qualityRate: Math.round(qualityRate * 100) / 100,
          },
        };
      })
    );

    // 排序：score 降序，总数降序
    allStats.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.stats.total - a.stats.total;
    });

    // 添加排名
    const ranked = allStats.slice(0, limit).map((s, i) => ({ ...s, rank: i + 1 }));

    res.json({
      data: ranked,
      period: `${days}d`,
      calculatedAt: new Date().toISOString(),
    });
  })
);

// ─── 5. Agent 统计详情（公开） ────────────────────────────────

marketplaceAutomationRouter.get(
  '/agents/:id/stats',
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.id);
    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        displayName: true,
        avatar: true,
        status: true,
        lastHeartbeatAt: true,
        tags: true,
      },
    });

    if (!agent) throw new HttpError(404, 'Agent 不存在');

    const byStatus = await prisma.marketplaceTask.groupBy({
      by: ['status'],
      where: { agentId },
      _count: { _all: true },
    });

    const statusCounts: Record<string, number> = {
      pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0,
    };
    for (const item of byStatus) {
      const count = typeof item._count === 'object'
        ? (item._count as Record<string, number>)._all ?? 0
        : 0;
      statusCounts[item.status] = count;
    }

    // 检查是否在线（5 分钟超时）
    const isOnline = agent.lastHeartbeatAt
      ? Date.now() - agent.lastHeartbeatAt.getTime() < 5 * 60 * 1000
      : false;

    res.json({
      data: {
        ...agent,
        isOnline,
        taskStats: statusCounts,
        lastSeen: agent.lastHeartbeatAt?.toISOString() ?? null,
      },
    });
  })
);
