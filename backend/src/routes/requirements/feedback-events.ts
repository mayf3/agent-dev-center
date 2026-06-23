/**
 * Feedback Events Routes
 *
 * GET /:id/feedback-events — 获取需求的反馈事件列表
 *
 * 反馈事件：当工作流中任何步骤的审批/测试/安全报告被 reject 时，
 * 系统自动向该需求历史上所有参与过该步骤的参与者发送通知（飞书消息），
 * 告知其工作被退回及原因。
 */
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { z } from 'zod';

const feedbackQuerySchema = z.object({
  query: z.object({
    fromStep: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

export function registerFeedbackEventRoutes(router: Router): void {

  /**
   * GET /:id/feedback-events — 查询需求的反馈事件列表
   */
  router.get(
    '/:id/feedback-events',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { query } = feedbackQuerySchema.parse({ query: req.query });

      // 权限校验：需求参与者（assignee/requester）或 admin/cto 可查看
      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: { assigneeId: true, requesterId: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');

      const isAdmin = req.user!.role === 'admin' || req.user!.internalRole === 'cto';
      const isParticipant =
        requirement.assigneeId === req.user!.id ||
        requirement.requesterId === req.user!.id;
      if (!isAdmin && !isParticipant) {
        throw new HttpError(403, '无权查看该需求的反馈事件');
      }

      const where: Record<string, unknown> = { requirementId: params.id };
      if (query.fromStep) {
        where.fromStep = query.fromStep;
      }

      const [events, total] = await Promise.all([
        prisma.feedbackEvent.findMany({
          where: where as any,
          orderBy: { createdAt: 'desc' },
          take: query.limit,
          skip: query.offset,
        }),
        prisma.feedbackEvent.count({
          where: where as any,
        }),
      ]);

      res.json({
        success: true,
        data: {
          events,
          total,
          limit: query.limit,
          offset: query.offset,
        },
      });
    }),
  );
}
