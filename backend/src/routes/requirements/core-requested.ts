/**
 * Core Requested Route
 *
 * GET /requested — requirements created by the current user (requesterId)
 *
 * The requester identity is ALWAYS derived from req.user.id.
 * No query parameter can override or broaden this filter.
 *
 * Query filters (currentStep, status, priority, search) are reused from the
 * shared buildRequirementListFilters helper, keeping the same semantics as
 * GET /api/requirements.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { serializeRequirement } from '../../utils/status.js';
import { requirementViewSchema, listRequirementsSchema } from '../../schemas/requirements.js';
import {
  REQUIREMENT_SUMMARY_SELECT,
  REQUIREMENT_SUMMARY_KEYS,
  toRequirementSummary,
  buildRequirementListFilters,
} from './requirement-selects.js';

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
} satisfies Prisma.RequirementInclude;

export function registerCoreRequestedRoutes(router: import('express').Router): void {

router.get(
  '/requested',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const view = requirementViewSchema.parse(req.query.view);

    // Parse query filters (only safe filtering parameters)
    const { query: parsedFilters } = listRequirementsSchema.parse({ query: req.query });
    const filters = buildRequirementListFilters(parsedFilters);

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

    // where is ALWAYS scoped to the authenticated user — no query param overrides this
    // The identity condition ANDs with the validated filters
    const where: Prisma.RequirementWhereInput = {
      AND: [
        { requesterId: actor.id },
        ...filters,
      ],
    };

    const [requirements, total] = await prisma.$transaction([
      prisma.requirement.findMany({
        where,
        ...(view === 'summary'
          ? { select: REQUIREMENT_SUMMARY_SELECT }
          : { include: requirementInclude }),
        orderBy: [
          { updatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.requirement.count({ where }),
    ]);

    const items = view === 'summary'
      ? (requirements as any[]).map(toRequirementSummary)
      : (requirements as any[]).map(serializeRequirement);

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

}
