import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const sessionsRouter = Router();

sessionsRouter.use(authRequired);

// 创建执行 Session
sessionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { taskId, requirementId, agentName, agentEmail, metadata } = req.body;

    // 验证关联资源存在
    if (taskId) {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new HttpError(404, '关联任务不存在');
    }

    if (requirementId) {
      const requirement = await prisma.requirement.findUnique({ where: { id: requirementId } });
      if (!requirement) throw new HttpError(404, '关联需求不存在');
    }

    const session = await prisma.executionSession.create({
      data: {
        taskId,
        requirementId,
        agentName,
        agentEmail,
        metadata: metadata || {}
      }
    });

    res.status(201).json({
      id: session.id,
      taskId: session.taskId,
      requirementId: session.requirementId,
      agentName: session.agentName,
      status: session.status,
      startedAt: session.startedAt
    });
  })
);

// 添加 Trace 日志
sessionsRouter.post(
  '/:sessionId/traces',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { kind, level, content, metadata, durationMs } = req.body;

    // 验证 session 存在
    const session = await prisma.executionSession.findUnique({
      where: { id: sessionId }
    });
    if (!session) {
      throw new HttpError(404, '执行会话不存在');
    }

    const trace = await prisma.executionTrace.create({
      data: {
        sessionId,
        kind: kind || 'info',
        level: level || 'info',
        content,
        metadata: metadata || null,
        durationMs
      }
    });

    res.status(201).json({
      id: trace.id,
      kind: trace.kind,
      level: trace.level,
      content: trace.content,
      createdAt: trace.createdAt
    });
  })
);

// 完成并关闭 Session
sessionsRouter.patch(
  '/:sessionId/complete',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { status, exitCode, errorMessage } = req.body;

    const session = await prisma.executionSession.findUnique({
      where: { id: sessionId }
    });
    if (!session) {
      throw new HttpError(404, '执行会话不存在');
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - session.startedAt.getTime();

    const updated = await prisma.executionSession.update({
      where: { id: sessionId },
      data: {
        status: status || 'completed',
        finishedAt,
        durationMs,
        exitCode,
        errorMessage
      }
    });

    res.json({
      id: updated.id,
      status: updated.status,
      finishedAt: updated.finishedAt,
      durationMs: updated.durationMs,
      exitCode: updated.exitCode
    });
  })
);

// 查询 Session 列表
sessionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { taskId, requirementId, agentName, status, limit = '50', offset = '0' } = req.query;

    const where: Prisma.ExecutionSessionWhereInput = {};

    if (taskId) where.taskId = taskId as string;
    if (requirementId) where.requirementId = requirementId as string;
    if (agentName) where.agentName = agentName as string;
    if (status) where.status = status as Prisma.SessionStatus;

    const [sessions, total] = await Promise.all([
      prisma.executionSession.findMany({
        where,
        include: {
          traces: {
            orderBy: { createdAt: 'asc' },
            take: 100 // 限制返回的 trace 数量
          },
          task: {
            select: { id: true, title: true }
          },
          requirement: {
            select: { id: true, title: true }
          }
        },
        orderBy: { startedAt: 'desc' },
        take: Math.min(parseInt(limit as string), 200),
        skip: parseInt(offset as string)
      }),
      prisma.executionSession.count({ where })
    ]);

    res.json({
      data: sessions.map(s => ({
        id: s.id,
        taskId: s.taskId,
        requirementId: s.requirementId,
        task: s.task,
        requirement: s.requirement,
        agentName: s.agentName,
        agentEmail: s.agentEmail,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        durationMs: s.durationMs,
        exitCode: s.exitCode,
        errorMessage: s.errorMessage,
        traces: s.traces,
        tracesCount: s.traces.length
      })),
      meta: {
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      }
    });
  })
);

// 获取单个 Session 详情（含所有 Traces）
sessionsRouter.get(
  '/:sessionId',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const session = await prisma.executionSession.findUnique({
      where: { id: sessionId },
      include: {
        traces: {
          orderBy: { createdAt: 'asc' }
        },
        task: {
          select: { id: true, title: true }
        },
        requirement: {
          select: { id: true, title: true }
        }
      }
    });

    if (!session) {
      throw new HttpError(404, '执行会话不存在');
    }

    res.json({
      id: session.id,
      taskId: session.taskId,
      requirementId: session.requirementId,
      task: session.task,
      requirement: session.requirement,
      agentName: session.agentName,
      agentEmail: session.agentEmail,
      status: session.status,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      durationMs: session.durationMs,
      exitCode: session.exitCode,
      errorMessage: session.errorMessage,
      metadata: session.metadata,
      traces: session.traces,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    });
  })
);

// 重试失败的 Session（创建新的 Session）
sessionsRouter.post(
  '/:sessionId/retry',
  authRequired,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const original = await prisma.executionSession.findUnique({
      where: { id: sessionId }
    });

    if (!original) {
      throw new HttpError(404, '执行会话不存在');
    }

    if (original.status !== 'failed' && original.status !== 'cancelled') {
      throw new HttpError(400, '只能重试失败或已取消的会话');
    }

    const newSession = await prisma.executionSession.create({
      data: {
        taskId: original.taskId,
        requirementId: original.requirementId,
        agentName: original.agentName,
        agentEmail: original.agentEmail,
        metadata: {
          ...original.metadata,
          retriedFrom: sessionId,
          originalStartedAt: original.startedAt
        }
      }
    });

    res.status(201).json({
      id: newSession.id,
      taskId: newSession.taskId,
      requirementId: newSession.requirementId,
      agentName: newSession.agentName,
      status: newSession.status,
      startedAt: newSession.startedAt,
      retriedFrom: sessionId
    });
  })
);
