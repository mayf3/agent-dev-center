/**
 * Core Lifecycle Routes
 *
 * GET /:id/revisions         — 修订历史
 * POST /:id/abandon          — 放弃需求（rejected → abandoned）
 * POST /:id/reactivate       — 重新激活（abandoned → draft）
 * POST /:id/lifecycle        — 归档需求（CTO 专属，stateVersion CAS）
 * POST /batch-lifecycle      — 批量归档（逐条原子，最多 100 条）
 */
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { listRevisionsSchema } from '../../schemas/revision.js';
import { serializeRequirement } from '../../utils/status.js';
import { notifyEvent } from '../../utils/notifications.js';
import { canReadRequirement, assertDomainReadAccess } from './utils.js';

// ── 校验 schema ──

const archiveActionSchema = z.object({
  body: z.object({
    action: z.literal('archive'),
    stateVersion: z.number().int().positive(),
    reason: z.string().trim().max(500).optional(),
  }),
});

const batchArchiveSchema = z.object({
  body: z.object({
    items: z
      .array(z.object({
        id: z.string().uuid(),
        stateVersion: z.number().int().positive(),
      }))
      .min(1)
      .max(100),
    reason: z.string().trim().max(500).optional(),
  }),
});

export function registerCoreLifecycleRoutes(router: import('express').Router): void {

// GET /:id/revisions - 修订历史
router.get(
  '/:id/revisions',
  asyncHandler(async (req, res) => {
    const { params, query } = listRevisionsSchema.parse({ params: req.params, query: req.query });
    const requirement = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, '无权查看');

    const skip = (query.page - 1) * query.pageSize;
    const [revisions, total] = await prisma.$transaction([
      prisma.requirementRevision.findMany({
        where: { requirementId: params.id },
        orderBy: { createdAt: 'desc' },
        skip, take: query.pageSize,
        include: { operator: { select: { id: true, name: true } } },
      }),
      prisma.requirementRevision.count({ where: { requirementId: params.id } }),
    ]);

    res.json({
      data: revisions,
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  })
);

// e1d273f5: POST /:id/abandon — 放弃需求（rejected → abandoned）
router.post(
  '/:id/abandon',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, '请先登录');
    const { params } = requirementIdSchema.parse({ params: req.params });
    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '需求不存在');
    assertDomainReadAccess(req.user!, existing);
    if (!['rejected', 'review_rejected', 'acceptance_rejected'].includes(existing.currentStep ?? '')) {
      throw new HttpError(400, `只能放弃被驳回的需求，当前步骤：${existing.currentStep}`);
    }
    // 只有需求提交者或 admin 可以放弃
    if (existing.requesterId !== req.user.id && req.user.role !== 'admin') {
      throw new HttpError(403, '只有需求提交者或管理员可以放弃需求');
    }
    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: { currentStep: 'abandoned' },
    });
    void notifyEvent('requirement.updated', { id: updated.id, title: updated.title, actor: req.user.name });

    // 审计日志
    await prisma.requirementAuditLog.create({
      data: {
        requirementId: params.id,
        action: 'abandon',
        operatorId: req.user!.id,
        operatorName: req.user!.name,
        detail: { fromStep: existing.currentStep, toStep: 'abandoned' },
      },
    }).catch(() => {}); // 非阻塞

    res.json(serializeRequirement(updated));
  })
);

// e1d273f5: POST /:id/reactivate — 重新激活（abandoned → draft）
router.post(
  '/:id/reactivate',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, '请先登录');
    const { params } = requirementIdSchema.parse({ params: req.params });
    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '需求不存在');
    assertDomainReadAccess(req.user!, existing);
    if (existing.currentStep !== 'abandoned') {
      throw new HttpError(400, `只能重新激活已放弃的需求，当前步骤：${existing.currentStep}`);
    }
    if (existing.requesterId !== req.user.id && req.user.role !== 'admin') {
      throw new HttpError(403, '只有需求提交者或管理员可以重新激活需求');
    }
    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: { currentStep: 'draft' },
    });
    void notifyEvent('requirement.updated', { id: updated.id, title: updated.title, actor: req.user.name });

    // 审计日志
    await prisma.requirementAuditLog.create({
      data: {
        requirementId: params.id,
        action: 'reactivate',
        operatorId: req.user!.id,
        operatorName: req.user!.name,
        detail: { fromStep: 'abandoned', toStep: 'draft' },
      },
    }).catch(() => {});

    res.json(serializeRequirement(updated));
  })
);

// ── POST /:id/lifecycle — 单条归档（CTO 专属，stateVersion CAS） ──
router.post(
  '/:id/lifecycle',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, '请先登录');
    const isAdmin = req.user.role === 'admin' || req.user.internalRole === 'cto';
    if (!isAdmin) throw new HttpError(403, '只有 CTO 可以执行归档操作');

    const { params } = requirementIdSchema.parse({ params: req.params });
    const { body } = archiveActionSchema.parse({ body: req.body });

    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '需求不存在');
    assertDomainReadAccess(req.user!, existing);

    // 终态检查：已归档的不能重复归档
    if (existing.currentStep === 'archived') {
      throw new HttpError(400, '该需求已为归档状态');
    }

    // stateVersion CAS 乐观锁
    const updated = await prisma.requirement.update({
      where: {
        id: params.id,
        stateVersion: body.stateVersion,
      },
      data: {
        currentStep: 'archived',
        stateVersion: { increment: 1 },
      },
    }).catch((err: any) => {
      if (err?.code === 'P2025') {
        throw new HttpError(409, 'stateVersion 不匹配，请在查看最新版本后重试');
      }
      throw err;
    });

    // 审计日志
    await prisma.requirementAuditLog.create({
      data: {
        requirementId: params.id,
        action: 'archive',
        operatorId: req.user!.id,
        operatorName: req.user!.name,
        stateVersion: updated.stateVersion,
        detail: {
          fromStep: existing.currentStep,
          toStep: 'archived',
          reason: body.reason,
          title: existing.title,
        },
      },
    }).catch(() => {});

    void notifyEvent('requirement.updated', {
      id: updated.id, title: updated.title,
      actor: req.user.name,
      action: 'archive',
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        title: updated.title,
        currentStep: 'archived',
        stateVersion: updated.stateVersion,
      },
    });
  })
);

// ── POST /batch-lifecycle — 批量归档（逐条原子，最多 100 条） ──
router.post(
  '/batch-lifecycle',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, '请先登录');
    const isAdmin = req.user.role === 'admin' || req.user.internalRole === 'cto';
    if (!isAdmin) throw new HttpError(403, '只有 CTO 可以执行批量归档操作');

    const { body } = batchArchiveSchema.parse({ body: req.body });

    const results: Array<{
      id: string;
      success: boolean;
      error?: string;
      currentStep?: string;
      stateVersion?: number;
    }> = [];

    let archivedCount = 0;
    let skipCount = 0;

    for (const item of body.items) {
      try {
        const existing = await prisma.requirement.findUnique({
          where: { id: item.id },
          select: { id: true, title: true, currentStep: true, stateVersion: true, domainKey: true },
        });

        if (!existing) {
          results.push({ id: item.id, success: false, error: '需求不存在' });
          skipCount++;
          continue;
        }

        try {
          assertDomainReadAccess(req.user!, existing);
        } catch {
          results.push({ id: item.id, success: false, error: '无权操作该需求' });
          skipCount++;
          continue;
        }

        if (existing.currentStep === 'archived') {
          results.push({ id: item.id, success: false, currentStep: 'archived', error: '已为归档状态' });
          skipCount++;
          continue;
        }

        const updated = await prisma.requirement.update({
          where: {
            id: item.id,
            stateVersion: item.stateVersion,
          },
          data: {
            currentStep: 'archived',
            stateVersion: { increment: 1 },
          },
          select: { id: true, currentStep: true, stateVersion: true },
        });

        results.push({
          id: item.id,
          success: true,
          currentStep: updated.currentStep ?? undefined,
          stateVersion: updated.stateVersion,
        });
        archivedCount++;

        // 非阻塞审计日志
        prisma.requirementAuditLog.create({
          data: {
            requirementId: item.id,
            action: 'archive',
            operatorId: req.user!.id,
            operatorName: req.user!.name,
            stateVersion: updated.stateVersion,
            detail: {
              toStep: 'archived',
              reason: body.reason,
              batch: true,
            },
          },
        }).catch(() => {});
      } catch (err: any) {
        const msg = err instanceof HttpError
          ? err.message
          : err?.code === 'P2025'
            ? 'stateVersion 不匹配'
            : '操作失败';
        results.push({ id: item.id, success: false, error: msg });
        skipCount++;
      }
    }

    res.json({
      success: true,
      data: {
        total: body.items.length,
        archivedCount,
        skipCount,
        results,
      },
    });
  })
);

}
