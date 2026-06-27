/**
 * Core List & Detail Routes
 *
 * GET /    — list
 * GET /:id — detail
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  listRequirementsSchema,
  requirementIdSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { canReadRequirement, roleAwareRequirementWhere } from './utils.js';
import { buildRequirementListFilters } from './requirement-selects.js';

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
} satisfies Prisma.RequirementInclude;

export function registerCoreListRoutes(router: import('express').Router): void {

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { query } = listRequirementsSchema.parse({ query: req.query });
    const actor = req.user!;
    const filters = buildRequirementListFilters(query);
    const where: Prisma.RequirementWhereInput = {
      AND: [roleAwareRequirementWhere(actor), ...filters],
    };

    const skip = (query.page - 1) * query.pageSize;
    const [requirements, total] = await prisma.$transaction([
      prisma.requirement.findMany({
        where, include: requirementInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip, take: query.pageSize
      }),
      prisma.requirement.count({ where })
    ]);

    res.json({
      data: requirements.map(serializeRequirement),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) }
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: requirementInclude
    });

    if (!requirement) throw new HttpError(404, 'requirement not found');
    if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, 'forbidden');

    const dependsOn = requirement.dependsOnIds.length > 0
      ? await prisma.requirement.findMany({
          where: { id: { in: requirement.dependsOnIds } },
          select: { id: true, title: true, currentStep: true, priority: true },
        })
      : [];

    const blocks = requirement.blockedBy.length > 0
      ? await prisma.requirement.findMany({
          where: { id: { in: requirement.blockedBy } },
          select: { id: true, title: true, currentStep: true, priority: true },
        })
      : [];

    res.json({
      ...serializeRequirement(requirement),
      dependsOn,
      blocks,
    });
  })
);

}
