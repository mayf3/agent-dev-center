/**
 * Core Kanban & Utility Routes
 *
 * GET /similar    — duplicate detection
 * GET /overdue    — overdue requirements
 * POST /overdue/notify — manual reminder
 * GET /kanban     — kanban board data
 * GET /summary    — lightweight summary
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { serializeRequirement } from '../../utils/status.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../../utils/similarity.js';
import { findOverdueRequirements, runOverdueCheck } from '../../utils/overdue-check.js';
import { roleAwareRequirementWhere, assertDomainReadAccess } from './utils.js';

export function registerCoreKanbanRoutes(router: import('express').Router): void {

router.get(
  '/similar',
  asyncHandler(async (req, res) => {
    const title = z.string().min(1).parse(req.query.title);
    const threshold = z.coerce.number().min(0).max(1).default(DEFAULT_SIMILARITY_THRESHOLD).parse(req.query.threshold);
    const normalizedInput = normalizeTitle(title);

    const actor = req.user!;
    const domainWhere = roleAwareRequirementWhere(actor);

    const allRequirements = await prisma.requirement.findMany({
      where: domainWhere,
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

router.get(
  '/overdue',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await findOverdueRequirements();
    res.json({ success: true, data: result });
  })
);

router.post(
  '/overdue/notify',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await runOverdueCheck();
    res.json({ success: true, data: result });
  })
);

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

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const stepFilter = req.query.step as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const where: Prisma.RequirementWhereInput = roleAwareRequirementWhere(actor);

    const filterValue = stepFilter || statusFilter;
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
