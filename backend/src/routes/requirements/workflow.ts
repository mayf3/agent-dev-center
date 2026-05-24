import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { canEditRequirement, canReadRequirement, getRequiredReports, isValidTransition, serializeRequirementAttachment, removeTemporaryRequirementUploads } from './helpers.js';
import { patchRequirementSchema, requirementIdSchema } from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { apiRequirementStatus, serializeRequirement } from '../../utils/status.js';
import { notifyEvent } from '../../utils/notifications.js';
import { requireInternalRole, requirePmApproval, checkWipLimit, preventSelfApproval, enforceReportReviewFlow } from '../../middleware/internal-workflow.js';
import { requirementUpload } from '../../lib/multer.js';
import { archiveFile } from '../../lib/archive.js';

export function registerWorkflowRoutes(router: Router) {
  // POST /:id/approve-pm — PM 审批
  router.post('/:id/approve-pm', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);
    const { action } = z.object({ action: z.enum(['approve', 'reject']) }).parse(req.body);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (requirement.approvalStatus !== 'pending_pm') {
      throw new HttpError(400, `当前审批状态为 ${requirement.approvalStatus}，无需 PM 审批`);
    }

    await prisma.requirement.update({
      where: { id },
      data: {
        approvalStatus: action === 'approve' ? 'approved' : 'rejected',
        status: action === 'approve' ? 'approved' : 'draft',
      },
    });

    await notifyEvent(action === 'approve' ? 'requirement.pm_approved' : 'requirement.pm_rejected', {
      requirementId: id, title: requirement.title, user: { id: user.id, name: user.name },
    });

    const updated = await prisma.requirement.findUnique({
      where: { id }, include: { reports: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    res.json({ data: serializeRequirement(updated!) });
  }));

  // PATCH /:id — 更新状态/字段
  router.patch('/:id', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);
    const body = patchRequirementSchema.parse(req.body);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const newStatus = body.status ? apiRequirementStatus(body.status) : undefined;
    const oldStatusApi = requirement.status;

    // === 权限检查 ===
    if (user.role !== 'admin') {
      if (body.status && body.status !== requirement.status) {
        if (user.role === 'developer') {
          const allowedAssign = requirement.assigneeId === user.id || requirement.assignee === user.name || requirement.assignee === user.email;
          if (!allowedAssign) throw new HttpError(403, '只能更新分配给自己的需求');
          if (body.status !== 'in-progress' && body.status !== 'testing') {
            throw new HttpError(403, 'Developer 只能把需求状态改为 in-progress 或 testing');
          }
        }
      }
    }

    // === WIP 限制 ===
    if (newStatus === 'in-progress' || (body.assigneeId && requirement.status === 'approved')) {
      await checkWipLimit(user, 3);
    }

    // === PM 审批 ===
    if (body.priority?.startsWith('P0') || body.priority?.startsWith('P1')) {
      await requirePmApproval(user, id, body.priority);
    }

    // === 流转校验 ===
    if (body.status && body.status !== requirement.status) {
      if (!isValidTransition(requirement.status, body.status)) {
        const allowed = ['draft', 'approved', 'in-progress', 'testing', 'review', 'deploying', 'done', 'rejected', 'clarifying']
          .filter(s => isValidTransition(requirement.status, s));
        throw new HttpError(422, `状态流转不合法：当前「${requirement.status}」不可直接流转到「${body.status}」，合法目标：[${allowed.join(', ')}]`);
      }
    }

    // === 报告校验 ===
    if (body.status) {
      await enforceReportReviewFlow(requirement, body.status, prisma);
    }

    // === 自审批阻止 ===
    if (body.status === 'done' || body.status === 'deploying') {
      await preventSelfApproval(user, requirement);
    }

    // === 构建更新数据 ===
    const updateData: Record<string, unknown> = {};
    if (body.title) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.priority) updateData.priority = body.priority;
    if (body.status) updateData.status = body.status;
    if (body.category) updateData.category = body.category;
    if (body.assigneeId) updateData.assigneeId = body.assigneeId;
    if (body.assignee) updateData.assignee = body.assignee;
    if (body.tags) updateData.tags = body.tags;
    if (body.estimatedHours) updateData.estimatedHours = body.estimatedHours;

    if (newStatus === 'in-progress') updateData.startedAt = new Date();
    if (body.status === 'done' || body.status === 'deploying') updateData.completedAt = new Date();

    const updated = await prisma.requirement.update({
      where: { id },
      data: updateData as any,
    });

    // === 自动记录修订 ===
    if (body.title || body.description || body.priority) {
      await prisma.requirementRevision.create({
        data: {
          requirementId: id,
          title: body.title || requirement.title,
          description: body.description ?? requirement.description,
          priority: body.priority || requirement.priority,
          changedBy: user.name,
        },
      });
    }

    const full = await prisma.requirement.findUnique({
      where: { id },
      include: { reports: { orderBy: { createdAt: 'desc' }, take: 5 }, children: { take: 5, orderBy: { createdAt: 'asc' } }, parent: true, revisions: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });

    await notifyEvent('requirement.updated', {
      requirementId: id, title: requirement.title, status: body.status, oldStatus: oldStatusApi,
      user: { id: user.id, name: user.name },
    });

    res.json({ data: serializeRequirement(full!) });
  }));

  // PUT /:id/assign — 分配
  router.put('/:id/assign', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);
    const { assigneeId, assignee } = z.object({
      assigneeId: z.string().optional(),
      assignee: z.string().optional(),
    }).parse(req.body);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');

    if (['done', 'rejected', 'deploying'].includes(requirement.status)) {
      throw new HttpError(400, `当前状态 ${requirement.status} 不可分配`);
    }

    const resolvedAssigneeId = assigneeId || (assignee
      ? (await prisma.user.findFirst({ where: { OR: [{ name: assignee }, { email: assignee }] } }))?.id || null
      : null);

    const resolvedAssignee = assignee || (resolvedAssigneeId
      ? (await prisma.user.findUnique({ where: { id: resolvedAssigneeId } }))?.name || null
      : null);

    const updated = await prisma.requirement.update({
      where: { id },
      data: {
        assigneeId: resolvedAssigneeId,
        assignee: resolvedAssignee,
        status: requirement.status === 'approved' ? 'in-progress' : requirement.status,
      } as any,
    });

    await prisma.requirementRevision.create({
      data: {
        requirementId: id,
        title: requirement.title,
        description: requirement.description,
        priority: requirement.priority,
        changedBy: user.name,
      },
    });

    await notifyEvent('requirement.assigned', {
      requirementId: id, title: requirement.title, assignee: resolvedAssignee,
      user: { id: user.id, name: user.name },
    });

    res.json({ data: serializeRequirement(updated) });
  }));

  // POST /:id/attachments — 上传附件
  router.post('/:id/attachments', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');

    requirementUpload(req, res, async (err) => {
      if (err) throw new HttpError(400, '文件上传失败: ' + err.message);
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        throw new HttpError(400, '请选择要上传的文件');
      }

      const attachments = (req.files as Express.Multer.File[]).map(f => serializeRequirementAttachment(id, f.filename));

      res.status(201).json({ data: attachments, message: `已上传 ${attachments.length} 个文件` });
    });
  }));

  // GET /:id/status-log — 状态历史
  router.get('/:id/status-log', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(user, requirement)) throw new HttpError(403, '无权限');

    const revisions = await prisma.requirementRevision.findMany({
      where: { requirementId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ data: revisions });
  }));
}
