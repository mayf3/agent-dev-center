import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { ensureReadableRequirement } from './utils.js';
import { buildRequirementAuditSummary } from '../../lib/requirement-audit-summary.js';
import type { AuditEventInput } from '../../lib/requirement-audit-summary.js';

export function registerAuditSummaryRoutes(router: Router): void {
  router.get(
    '/:id/audit-summary',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const requirement = await ensureReadableRequirement(params.id, req.user!);

      // Fetch requirement with all needed fields
      const fullRequirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          title: true,
          status: true,
          currentStep: true,
          assigneeId: true,
          assignee: true,
          requesterId: true,
          requester: true,
        },
      });
      if (!fullRequirement) throw new HttpError(404, '需求不存在');

      // Fetch all events for this requirement (ascending)
      const events = await prisma.requirementEventLedger.findMany({
        where: { requirementId: params.id },
        orderBy: { createdAt: 'asc' },
      });

      // Map events to the input shape expected by the pure function
      const auditEvents: AuditEventInput[] = events.map((ev) => ({
        id: ev.id,
        eventType: ev.eventType,
        actorId: ev.actorId,
        actorName: ev.actorName,
        actorType: ev.actorType,
        fromStep: ev.fromStep,
        toStep: ev.toStep,
        reasonCode: ev.reasonCode,
        reasonText: ev.reasonText,
        metadata: ev.metadata as Record<string, unknown> | null,
        relatedReportId: ev.relatedReportId,
        relatedAuditLogId: ev.relatedAuditLogId,
        createdAt: ev.createdAt,
      }));

      const result = buildRequirementAuditSummary(
        {
          id: fullRequirement.id,
          title: fullRequirement.title,
          status: fullRequirement.status,
          currentStep: fullRequirement.currentStep,
          assigneeId: fullRequirement.assigneeId,
          assigneeName: fullRequirement.assignee,
          requesterId: fullRequirement.requesterId,
          requesterName: fullRequirement.requester,
        },
        auditEvents,
      );

      res.json({ success: true, data: result });
    }),
  );
}
