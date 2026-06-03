import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const dailyLogsRouter = Router();

// ── Validation Schemas ──

const submitLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  status: z.enum(['working', 'completed', 'blocked', 'idle']).default('working'),
  content: z.string().min(1).max(10000),
  problems: z.string().max(5000).optional(),
});

const queryLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  agentId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── POST /api/daily-logs — Submit a daily log ──

dailyLogsRouter.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const body = submitLogSchema.parse(req.body);
    const actor = req.user!;

    // Resolve agent: find the agent linked to this user
    const agent = await prisma.marketplaceAgent.findFirst({
      where: {
        OR: [
          { userId: actor.id },
          { ownerId: actor.id },
        ],
      },
      select: { id: true, name: true },
    });

    if (!agent) {
      throw new HttpError(403, 'No agent linked to your account');
    }

    // Upsert: one log per agent per day
    const log = await prisma.dailyLog.upsert({
      where: {
        agentId_date: { agentId: agent.id, date: body.date },
      },
      update: {
        status: body.status,
        content: body.content,
        problems: body.problems ?? null,
        submittedAt: new Date(),
      },
      create: {
        agentId: agent.id,
        date: body.date,
        status: body.status,
        content: body.content,
        problems: body.problems ?? null,
      },
    });

    res.status(201).json({ success: true, data: log });
  })
);

// ── GET /api/daily-logs — Query daily logs ──

dailyLogsRouter.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const query = queryLogSchema.parse(req.query);
    const actor = req.user!;

    // Build where clause
    const where: any = {};

    // Date range or single date
    if (query.date) {
      where.date = query.date;
    } else if (query.from || query.to) {
      where.date = {};
      if (query.from) (where.date as any).gte = query.from;
      if (query.to) (where.date as any).lte = query.to;
    }

    // Agent filter
    if (query.agentId) {
      where.agentId = query.agentId;
    } else {
      // Non-admin users: only see their own agent's logs
      const agent = await prisma.marketplaceAgent.findFirst({
        where: {
          OR: [
            { userId: actor.id },
            { ownerId: actor.id },
          ],
        },
        select: { id: true },
      });
      // CTO/admin can see all
      if (actor.role !== 'admin' && actor.role !== 'cto_agent') {
        where.agentId = agent?.id ?? 'none';
      }
    }

    const [logs, total] = await Promise.all([
      prisma.dailyLog.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, displayName: true } },
        },
        orderBy: { date: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.dailyLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  })
);

// ── GET /api/daily-logs/summary?date= — Agent submission summary ──

dailyLogsRouter.get(
  '/summary',
  authRequired,
  asyncHandler(async (req, res) => {
    const date = req.query.date as string | undefined;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // Get all active agents
    const agents = await prisma.marketplaceAgent.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, displayName: true },
    });

    // Get logs for the target date
    const logs = await prisma.dailyLog.findMany({
      where: { date: targetDate },
      select: {
        agentId: true,
        status: true,
        problems: true,
        submittedAt: true,
      },
    });

    const logMap = new Map(logs.map((l) => [l.agentId, l]));

    const summary = agents.map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      displayName: agent.displayName,
      submitted: logMap.has(agent.id),
      log: logMap.get(agent.id) || null,
    }));

    const submitted = summary.filter((s) => s.submitted).length;
    const notSubmitted = summary.filter((s) => !s.submitted);

    res.json({
      success: true,
      data: {
        date: targetDate,
        totalAgents: agents.length,
        submitted,
        notSubmittedCount: notSubmitted.length,
        notSubmittedAgents: notSubmitted.map((s) => ({
          agentId: s.agentId,
          agentName: s.agentName,
          displayName: s.displayName,
        })),
        details: summary,
      },
    });
  })
);
