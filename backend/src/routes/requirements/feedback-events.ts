/**
 * Feedback Events — 审批打回自动通知系统
 *
 * - GET  /:id/feedback-events  — 查询需求的反馈事件列表
 * - 在 workflow-reject.ts 中写入 feedback_events 记录
 */

import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { z } from 'zod';

const listFeedbackEventsSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).transform(v => Math.min(v, 100)).default(20),
  }),
});

export function registerFeedbackEventRoutes(router: Router) {
  // GET /:id/feedback-events — 查询需求的反馈事件
  router.get(
    '/:id/feedback-events',
    authRequired,
    asyncHandler(async (req, res) => {
      const { params, query } = listFeedbackEventsSchema.parse({
        params: req.params,
        query: req.query,
      });

      const skip = (query.page - 1) * query.pageSize;

      const [events, total] = await prisma.$transaction([
        prisma.feedbackEvent.findMany({
          where: { requirementId: params.id },
          orderBy: { createdAt: 'desc' },
          skip,
          take: query.pageSize,
        }),
        prisma.feedbackEvent.count({
          where: { requirementId: params.id },
        }),
      ]);

      res.json({
        success: true,
        data: events,
        meta: { total, page: query.page, pageSize: query.pageSize },
      });
    }),
  );
}

/**
 * 写入反馈事件
 */
export async function createFeedbackEvent(data: {
  requirementId: string;
  fromStep: string;
  toStep: string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  reason?: string | null;
}) {
  try {
    await prisma.feedbackEvent.create({ data });
  } catch {
    // 非阻塞写入
  }
}
