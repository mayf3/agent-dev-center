import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { canReadRequirement } from './utils.js';

const SENSITIVE_KEYS = new Set([
  'token', 'password', 'secret', 'jwt', 'authorization',
  'database_url', 'accesstoken', 'refreshtoken', 'apikey',
]);

function sanitize(obj: any) {
  if (obj?.metadata && typeof obj.metadata === 'object') {
    for (const k of Object.keys(obj.metadata)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) delete obj.metadata[k];
    }
  }
  if (obj?.evidence && typeof obj.evidence === 'object') {
    for (const k of Object.keys(obj.evidence)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) delete obj.evidence[k];
    }
  }
  return obj;
}

export function registerEventRoutes(router: Router): void {
  router.get(
    '/:id/events',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: { id: true, requesterId: true, requester: true, assigneeId: true, assignee: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, '无权查看该需求的事件流');

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500);
      const eventType = req.query.eventType as string | undefined;
      const reasonCode = req.query.reasonCode as string | undefined;

      const where: any = { requirementId: params.id };
      if (eventType) where.eventType = eventType;
      if (reasonCode) where.reasonCode = reasonCode;

      const events = await prisma.requirementEventLedger.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      res.json({ success: true, data: events.map(sanitize) });
    }),
  );
}
