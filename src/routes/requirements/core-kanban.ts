/**
 * Core Kanban & Utility Routes
 *
 * GET /similar    — 重复检测
 * GET /overdue    — 超时需求列表
 * POST /overdue/notify — 手动催办
 * GET /kanban     — 看板数据
 * GET /summary    — 轻量摘要接口
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { serializeRequirement } from '../../utils/status.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../../utils/similarity.js';
import { findOverdueRequirements, runOverdueCheck } from '../../utils/overdue-check.js';
import { roleAwareRequirementWhere } from './utils.js';
import { parseSteps, getCurrentStep, mapUserRole } from './workflow-helpers.js';

export function registerCoreKanbanRoutes(router: import('express').Router): void {

// GET /similar - 重复检测
router.get(
  '/similar',
  asyncHandler(async (req, res) => {
    const title = z.string().min(1).parse(req.query.title);
    const threshold = z.coerce.number().min(0).max(1).default(DEFAULT_SIMILARITY_THRESHOLD).parse(req.query.threshold);
    const normalizedInput = normalizeTitle(title);

    const allRequirements = await prisma.requirement.findMany({
      select: { id: true, title: true, currentStep: true, priority: true, createdAt: true },
    });

    const similar = allRequirements
      .map(r => ({
        id: r.id, title: r.title, currentStep: r.currentStep, priority: r.priority, createdAt: r.createdAt,
        score: similarity(normalizedInput, normalizeTitle(r.title)),
      }))
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ success: true, data: similar, query: { title, threshold } });
  })
);

// GET /overdue - 超时需求列表
router.get(
  '/overdue',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await findOverdueRequirements();
    res.json({ success: true, data: result });
  })
);

// POST /overdue/notify - 手动催办
router.post(
  '/overdue/notify',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await runOverdueCheck();
    res.json({ success: true, data: result });
  })
);

// GET /kanban - 看板数据
router.get(
  '/kanban',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const where: Prisma.RequirementWhereInput = roleAwareRequirementWhere(actor);

    const requirements = await prisma.requirement.findMany({
      where,
      include: { tasks: true, assigneeUser: { select: { name: true } } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    // Group by currentStep
    const grouped: Record<string, typeof requirements> = {};
    for (const r of requirements) {
      const step = r.currentStep || 'pending';
      if (!grouped[step]) grouped[step] = [];
      grouped[step].push(r);
    }

    const serialized: Record<string, unknown[]> = {};
    for (const [step, items] of Object.entries(grouped)) {
      serialized[step] = items.map(serializeRequirement);
    }

    res.json({ data: serialized, meta: { total: requirements.length } });
  })
);

// GET /mine - 我的活跃任务（Agent 心跳专用，一站式端点）
// 只按 assigneeId 过滤，不按角色。用户的"我的任务" = 分配给当前用户的任务
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const actor = req.user!;

    const terminalSteps = ['done', 'abandoned', 'cancelled', 'rejected'];

    const where: Prisma.RequirementWhereInput = {
      assigneeId: actor.id,
      currentStep: { notIn: terminalSteps },
    };

    // 分页参数
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

    const [requirements, total] = await prisma.$transaction([
      prisma.requirement.findMany({
        where,
        include: {
          tasks: true,
          assigneeUser: { select: { name: true } },
          workflow: { select: { steps: true, name: true, displayName: true } },
        },
        orderBy: [
          // P0 最高优先级，然后按 updatedAt 排序
          { priority: 'asc' },   // P0 < P1 < P2 < P3 字符串排序刚好对
          { updatedAt: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.requirement.count({ where }),
    ]);

    // 为每条需求计算"下一步动作提示"
    const items = requirements.map(r => {
      let nextAction: string | null = null;
      let requiredReports: string[] = [];
      let missingReports: string[] = [];

      if (r.workflow && r.currentStep) {
        try {
          const steps = parseSteps(r.workflow.steps as any);
          const currentStepDef = getCurrentStep(steps, r.currentStep);
          if (currentStepDef) {
            requiredReports = currentStepDef.requiredReports;
            // 简单动作提示（同步检查，不查报告状态避免 N+1）
            const matchedRole = mapUserRole(actor.internalRole, currentStepDef.role);
            const canOperate = !!matchedRole || actor.role === 'admin' || actor.role === 'cto_agent';

            if (canOperate) {
              if (currentStepDef.requiredReports.length > 0) {
                nextAction = `提交 ${currentStepDef.requiredReports.join(' + ')} 报告后可推进`;
              } else {
                nextAction = `可以 advance 到下一步`;
              }
            } else {
              nextAction = `等待 ${currentStepDef.role} 角色操作`;
            }
          }
        } catch {
          nextAction = null;
        }
      }

      return {
        ...serializeRequirement(r),
        workflow: r.workflow ? {
          name: r.workflow.name,
          displayName: r.workflow.displayName,
        } : null,
        nextAction,
        requiredReports,
      };
    });

    res.json({
      data: items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  })
);

// GET /summary - 轻量摘要接口 (47ce94b8: 6字段 + status过滤, 目标<200ms)
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const stepFilter = req.query.step as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const where: Prisma.RequirementWhereInput = roleAwareRequirementWhere(actor);

    // Filter by currentStep (step param preferred, status param as fallback)
    const filterValue = stepFilter || statusFilter;
    // e1d273f5: 默认排除 abandoned（除非明确筛选）
    const excludeAbandoned = filterValue !== 'abandoned' && filterValue !== 'all';

    if (filterValue && filterValue !== 'all') {
      if (filterValue === 'active') {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { currentStep: { notIn: ['done', 'abandoned'] } },
        ];
      } else {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { currentStep: filterValue } as Prisma.RequirementWhereInput
        ];
      }
    } else if (excludeAbandoned) {
      // 默认不显示 abandoned
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        { currentStep: { not: 'abandoned' } },
      ];
    }

    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        title: true,
        currentStep: true,
        priority: true,
        assignee: true,
        assigneeId: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const data = requirements.map(r => ({
      id: r.id,
      title: r.title,
      currentStep: r.currentStep,
      priority: r.priority,
      assigneeName: r.assignee,
      assignee: r.assigneeId,
    }));

    res.json({ success: true, data, meta: { total: data.length } });
  })
);

}
