import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import {
  patchRequirementSchema,
  requirementIdSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { apiRequirementStatus, serializeRequirement, type RequirementStatusApi } from '../../utils/status.js';
import { notifyEvent } from '../../utils/notifications.js';
import { requirePmApproval, checkWipLimit } from '../../middleware/internal-workflow.js';
import {
  buildStatusData,
  isValidTransition,
  checkAcceptanceReports,
  VALID_TRANSITIONS
} from './utils.js';

export function registerStatusRoutes(router: import('express').Router): void {

// PATCH /:id - 状态更新（含流转校验、WIP限制、验收约束）
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = patchRequirementSchema.parse({ params: req.params, body: req.body });

    const existing = await prisma.requirement.findUnique({
      where: { id: params.id },
      select: {
        id: true, title: true, description: true, priority: true, status: true,
        requester: true, requesterId: true, department: true, assignee: true,
        assigneeId: true, dueDate: true, pmApprovedAt: true, attachment: true,
        workflowId: true, currentStep: true,
        tasks: { select: { id: true, title: true } },
      },
    });
    if (!existing) throw new HttpError(404, '需求不存在');

    // 如果已分配工作流，拒绝旧版状态流转
    if (existing.workflowId && body.status) {
      throw new HttpError(400, '该需求已启用工作流模式，请使用 /workflow/advance 接口推进，不再支持旧版状态直接修改');
    }

    // 非管理员/CTO 权限检查
    if (req.user!.role !== 'admin' && req.user!.role !== 'cto_agent') {
      const isAssignee = existing.assigneeId === req.user!.id || existing.assignee === req.user!.name;
      if (!isAssignee) throw new HttpError(403, '当前角色无权执行此操作');
      const allowedStatuses = ['in-progress', 'testing'];
      if (body.status && !allowedStatuses.includes(body.status)) {
        throw new HttpError(403, '开发者只能将状态改为 in-progress 或 testing');
      }
      if (body.assignee !== undefined || body.rejectReason !== undefined) {
        throw new HttpError(403, '开发者不能修改分配人或拒绝原因');
      }
    }

    if (body.status === 'rejected' && !body.rejectReason) {
      throw new HttpError(400, '拒绝需求时必须填写拒绝原因');
    }

    // WIP 限制检查
    if (body.status === 'in-progress' && existing.status !== 'in_progress') {
      const assigneeId = existing.assigneeId;
      if (assigneeId) {
        const inProgressCount = await prisma.requirement.count({
          where: {
            assigneeId,
            status: 'in_progress',
            id: { not: params.id }
          }
        });
        const WIP_LIMIT = parseInt(process.env.WIP_LIMIT || '2', 10);
        if (inProgressCount >= WIP_LIMIT) {
          throw new HttpError(403, `WIP 限制：当前开发已有 ${inProgressCount} 个进行中的需求，已达上限 (${WIP_LIMIT})`);
        }
      }
    }

    // P0-P1 PM 审批检查
    if ((body.status === 'approved' || body.status === 'in-progress') &&
        (existing.priority === 'P0' || existing.priority === 'P1')) {
      if (!existing.pmApprovedAt) {
        throw new HttpError(403, 'P0/P1 需求必须先经 PM 审批才能分配开发');
      }
    }

    // 状态流转校验
    if (body.status) {
      const currentStatus = apiRequirementStatus[existing.status as keyof typeof apiRequirementStatus] as string;
      if (!isValidTransition(currentStatus, body.status)) {
        const allowed = VALID_TRANSITIONS[currentStatus] || [];
        throw new HttpError(400, `状态流转不合法：当前「${currentStatus}」不可直接流转到「${body.status}」，合法目标：[${allowed.join(', ')}]`);
      }
    }

    // 验收约束
    if (body.status && ['testing', 'review', 'deploying', 'done'].includes(body.status)) {
      const allowPending = body.status === 'testing';
      const { ok, missing } = await checkAcceptanceReports(params.id, body.status as RequirementStatusApi, allowPending);
      if (!ok) {
        const reportTypeLabels: Record<string, string> = {
          DEV_SELF_CHECK: '开发自检报告',
          SECURITY_REVIEW: '安全检查报告',
          TEST_REPORT: '测试报告',
          CTO_REVIEW: 'CTO验收报告',
          DEPLOY_CONFIRM: '发布确认报告',
        };
        const missingLabels = missing.map((t) => reportTypeLabels[t] ?? t).join('、');
        const msg = body.status === 'testing'
          ? `验收约束：流转到「${body.status}」前，必须先提交以下报告：${missingLabels}`
          : `验收约束：流转到「${body.status}」前，必须有以下已通过的报告：${missingLabels}`;
        throw new HttpError(400, msg);
      }
    }

    const targetAssignee = body.assignee ?? existing.assignee;
    const shouldCreateTask =
      targetAssignee &&
      ['approved', 'in-progress'].includes(body.status ?? '') &&
      existing.tasks.length === 0;

    const updated = await prisma.$transaction(async (tx) => {
      let assigneeId = existing.assigneeId;
      if (body.assignee && body.assignee !== existing.assignee) {
        const assigneeUser = await tx.user.findFirst({
          where: { OR: [{ name: body.assignee }, { email: body.assignee }] },
          select: { id: true }
        });
        assigneeId = assigneeUser?.id ?? null;
      }

      await tx.requirement.update({
        where: { id: params.id },
        data: {
          status: buildStatusData(body.status),
          assignee: body.assignee,
          assigneeId,
          rejectReason: body.status === 'rejected' ? body.rejectReason : body.status ? null : body.rejectReason,
          ...(body.gitHash !== undefined ? { gitHash: body.gitHash } : {}),
          ...(body.deployVersion !== undefined ? { deployVersion: body.deployVersion } : {})
        }
      });

      await tx.requirementRevision.create({
        data: {
          requirementId: params.id,
          title: existing.title, description: existing.description,
          priority: existing.priority, status: existing.status,
          requester: existing.requester, department: existing.department,
          assignee: existing.assignee, dueDate: existing.dueDate,
          attachment: existing.attachment,
          revisionNote: body.status ? `状态变更: ${body.status}` : undefined,
          operatorId: req.user!.id,
        }
      });

      if (shouldCreateTask) {
        await tx.task.create({
          data: {
            requirementId: params.id,
            title: `开发需求：${existing.title}`,
            description: existing.description,
            agentType: targetAssignee,
            status: 'todo'
          }
        });
      }

      return tx.requirement.findUniqueOrThrow({
        where: { id: params.id },
        include: { tasks: true }
      });
    });

    void notifyEvent('requirement.status_changed', {
      id: updated.id, title: updated.title, status: body.status,
      actor: req.user!.name, assignee: updated.assignee,
      requesterId: updated.requesterId, assigneeId: updated.assigneeId
    });

    res.json(serializeRequirement(updated));
  })
);

// POST /batch-status - 批量状态变更
const batchStatusSchema = z.object({
  body: z.object({
    ids: z.array(z.string().uuid()).min(1).max(50),
    status: z.enum(['pending', 'clarifying', 'approved', 'rejected', 'in-progress', 'testing', 'review', 'deploying', 'done']),
    rejectReason: z.string().trim().optional()
  })
});

router.post(
  '/batch-status',
  requireRoles('admin'),
  asyncHandler(async (req, res) => {
    const { body } = batchStatusSchema.parse({ body: req.body });

    const requirements = await prisma.requirement.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, title: true, status: true, assignee: true, tasks: true }
    });
    if (requirements.length !== body.ids.length) throw new HttpError(400, '部分需求不存在');
    if (body.status === 'rejected' && !body.rejectReason) throw new HttpError(400, '批量拒绝时必须填写拒绝原因');

    if (['testing', 'review', 'deploying', 'done'].includes(body.status)) {
      for (const item of requirements) {
        const { ok, missing } = await checkAcceptanceReports(item.id, body.status as RequirementStatusApi, body.status === 'testing');
        if (!ok) throw new HttpError(400, `「${item.title}」缺少验收报告，无法批量流转到「${body.status}」`);
      }
    }

    const now = new Date();
    const operatorId = req.user!.id;
    const updated = await prisma.$transaction(async (tx) => {
      for (const item of requirements) {
        await tx.requirement.update({
          where: { id: item.id },
          data: {
            status: buildStatusData(body.status),
            rejectReason: body.status === 'rejected' ? body.rejectReason : null,
            updatedAt: now
          }
        });
        await tx.requirementRevision.create({
          data: {
            requirementId: item.id, title: item.title, description: '', priority: 'P2',
            status: item.status, requester: '', department: '', assignee: item.assignee,
            revisionNote: `批量状态变更: ${body.status}`, operatorId,
          }
        });
      }
      return tx.requirement.findMany({ where: { id: { in: body.ids } }, include: { tasks: true } });
    });

    res.json({ success: true, count: updated.length });
  })
);

// GET /users/list - 用户列表
router.get(
  '/users/list',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ data: users });
  })
);

}
