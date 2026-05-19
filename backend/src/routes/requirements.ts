import { createReadStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  getRequirementUploadMimeType,
  getRequirementUploadPath,
  getRequirementUploadUrl,
  isAllowedRequirementUploadFilename,
  requirementUpload
} from '../lib/multer.js';
import {
  createRequirementSchema,
  listRequirementsSchema,
  patchRequirementSchema,
  requirementIdSchema,
  updateRequirementSchema
} from '../schemas/requirements.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import {
  apiRequirementStatus,
  prismaRequirementStatus,
  serializeRequirement,
  type RequirementStatusApi
} from '../utils/status.js';
import { notifyEvent } from '../utils/notifications.js';
import { listRevisionsSchema } from '../schemas/revision.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../utils/similarity.js';
import { runOverdueCheck, findOverdueRequirements } from '../utils/overdue-check.js';

export const requirementsRouter = Router();

requirementsRouter.use(authRequired);

/** 权限判断：是否可查看该需求（基于 user.id） */
function canReadRequirement(user: Express.AuthUser, requirement: { requesterId: string | null; requester: string; assigneeId: string | null; assignee: string | null }) {
  if (user.role === 'admin') {
    return true;
  }

  if (user.role === 'requester') {
    // 优先用 ID 匹配，兼容旧数据用 name/email fallback
    return requirement.requesterId === user.id ||
           requirement.requester === user.name ||
           requirement.requester === user.email;
  }

  // developer
  return requirement.assigneeId === user.id ||
         requirement.assignee === user.name ||
         requirement.assignee === user.email;
}

/** 权限判断：是否可编辑该需求（基于 user.id） */
function canEditRequirement(user: Express.AuthUser, requirement: { requesterId: string | null; requester: string; status: unknown }) {
  if (user.role === 'admin') {
    return true;
  }

  return (
    user.role === 'requester' &&
    (requirement.requesterId === user.id || requirement.requester === user.name) &&
    ['pending', 'rejected'].includes(String(requirement.status))
  );
}

/** 基于角色过滤查询条件（使用 user.id） */
function roleAwareRequirementWhere(user: Express.AuthUser): Prisma.RequirementWhereInput {
  if (user.role === 'admin') {
    return {};
  }

  if (user.role === 'requester') {
    return {
      OR: [{ requesterId: user.id }, { requester: user.name }, { requester: user.email }]
    };
  }

  return {
    OR: [{ assigneeId: user.id }, { assignee: user.name }, { assignee: user.email }]
  };
}

function buildStatusData(status?: RequirementStatusApi) {
  return status ? prismaRequirementStatus[status] : undefined;
}

/**
 * 硬性验收约束 + 强制逐步流转
 *
 * 状态流转规则（必须逐步流转，不可跳步）：
 *   pending → approved → in-progress → testing → review → deploying → done
 *                                      ↓           ↓          ↓         ↓
 *                                 DEV_SELF   TEST_RPT    CTO_REVIEW  DEPLOY_CONFIRM
 *                                            SECURITY
 *
 * 每步必需的 approved 报告：
 *   → testing  : DEV_SELF_CHECK
 *   → review   : DEV_SELF_CHECK + TEST_REPORT
 *   → deploying: DEV_SELF_CHECK + SECURITY_REVIEW + TEST_REPORT + CTO_REVIEW
 *   → done     : DEV_SELF_CHECK + SECURITY_REVIEW + TEST_REPORT + CTO_REVIEW + DEPLOY_CONFIRM
 */

/** 合法的前置状态（强制逐步流转） */
const VALID_TRANSITIONS: Record<string, string[]> = {
  'pending':     ['clarifying', 'approved', 'rejected'],
  'clarifying':  ['approved', 'pending', 'rejected'],
  'approved':    ['in-progress', 'rejected'],
  'in-progress': ['testing', 'rejected'],
  'testing':     ['review', 'in-progress', 'rejected'],
  'review':      ['deploying', 'testing', 'in-progress', 'rejected'],
  'deploying':   ['done', 'review', 'rejected'],
  'done':        [],
  'rejected':    ['pending'],
};

const REQUIRED_REPORTS_FOR_TESTING: Array<import('@prisma/client').ReportType> = [
  'DEV_SELF_CHECK',
];

const REQUIRED_REPORTS_FOR_REVIEW: Array<import('@prisma/client').ReportType> = [
  'DEV_SELF_CHECK',
  'TEST_REPORT',
];

const REQUIRED_REPORTS_FOR_DEPLOYING: Array<import('@prisma/client').ReportType> = [
  'DEV_SELF_CHECK',
  'SECURITY_REVIEW',
  'TEST_REPORT',
  'CTO_REVIEW',
];

const REQUIRED_REPORTS_FOR_DONE: Array<import('@prisma/client').ReportType> = [
  'DEV_SELF_CHECK',
  'SECURITY_REVIEW',
  'TEST_REPORT',
  'CTO_REVIEW',
  'DEPLOY_CONFIRM',
];

/** 检查状态流转是否合法（逐步流转） */
function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/** 获取目标状态需要的报告列表 */
function getRequiredReports(targetStatus: RequirementStatusApi): Array<import('@prisma/client').ReportType> {
  switch (targetStatus) {
    case 'testing':    return REQUIRED_REPORTS_FOR_TESTING;
    case 'review':     return REQUIRED_REPORTS_FOR_REVIEW;
    case 'deploying':  return REQUIRED_REPORTS_FOR_DEPLOYING;
    case 'done':       return REQUIRED_REPORTS_FOR_DONE;
    default:           return [];
  }
}

async function checkAcceptanceReports(
  requirementId: string,
  targetStatus: RequirementStatusApi,
  allowPending: boolean = false,
): Promise<{ ok: boolean; missing: string[] }> {
  const required = getRequiredReports(targetStatus);

  if (required.length === 0) return { ok: true, missing: [] };

  // 对于 testing 阶段，允许 pending 状态的报告（开发者提交报告后即可流转）
  // 对于 review/deploying/done 阶段，必须 approved
  const validStatuses = allowPending ? ['approved', 'pending'] : ['approved'];
  const submittedReports = await prisma.requirementReport.findMany({
    where: {
      requirementId,
      reportType: { in: required },
      status: { in: validStatuses },
    } as any,
    select: { reportType: true, status: true },
  });

  const reportedTypes = new Set(submittedReports.map((r) => r.reportType));
  const missing = required.filter((t) => !reportedTypes.has(t));

  return { ok: missing.length === 0, missing };
}

async function ensureReadableRequirement(requirementId: string, user: Express.AuthUser) {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: {
      id: true,
      requesterId: true,
      requester: true,
      assigneeId: true,
      assignee: true
    }
  });

  if (!requirement) {
    throw new HttpError(404, '需求不存在');
  }

  if (!canReadRequirement(user, requirement)) {
    throw new HttpError(403, '无权查看该需求');
  }

  return requirement;
}

function getRequirementAttachmentPath(requirementId: string, filename: string): string {
  return getRequirementUploadPath(path.join(requirementId, filename));
}

function serializeRequirementAttachment(requirementId: string, filename: string) {
  const filePath = getRequirementAttachmentPath(requirementId, filename);
  const stat = statSync(filePath);

  if (!stat.isFile()) {
    return null;
  }

  return {
    filename,
    originalName: filename,
    url: getRequirementUploadUrl(path.join(requirementId, filename)),
    size: stat.size,
    mimeType: getRequirementUploadMimeType(filename) || 'application/octet-stream'
  };
}

function removeTemporaryRequirementUploads(files: Express.Multer.File[]) {
  for (const file of files) {
    try {
      unlinkSync(file.path);
    } catch {
      // Ignore cleanup errors; the main request error is more relevant.
    }
  }
}

requirementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { body } = createRequirementSchema.parse({ body: req.body });
    const actor = req.user!;

    // 重复检测：查找相似标题的需求
    const allRequirements = await prisma.requirement.findMany({
      select: { id: true, title: true, status: true },
    });
    const normalizedNew = normalizeTitle(body.title);
    const similarItems = allRequirements
      .map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        score: similarity(normalizedNew, normalizeTitle(r.title)),
      }))
      .filter(r => r.score >= DEFAULT_SIMILARITY_THRESHOLD && r.title !== body.title)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const requirement = await prisma.requirement.create({
      data: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        requester: body.requester ?? actor.name,
        requesterId: actor.id,
        department: body.department,
        // 权限控制：仅 admin（CTO）可在提交时指定负责人
        assignee: (actor.role === 'admin') ? body.assignee : null,
        dueDate: body.dueDate,
        attachment: body.attachment
      },
      include: { tasks: true }
    });

    void notifyEvent('requirement.submitted', {
      id: requirement.id,
      title: requirement.title,
      actor: actor.name,
      assignee: requirement.assignee
    });

    const response: Record<string, unknown> = serializeRequirement(requirement);
    if (similarItems.length > 0) {
      response.warning = {
        type: 'possible_duplicate',
        message: `检测到 ${similarItems.length} 个相似需求（相似度 ≥ 80%）`,
        similar: similarItems,
      };
    }

    res.status(201).json(response);
  })
);

/**
 * GET /api/requirements/similar?title=xxx&threshold=0.8
 * 需求重复检测
 */
requirementsRouter.get(
  '/similar',
  asyncHandler(async (req, res) => {
    const title = z.string().min(1).parse(req.query.title);
    const threshold = z.coerce.number().min(0).max(1).default(DEFAULT_SIMILARITY_THRESHOLD).parse(req.query.threshold);
    const normalizedInput = normalizeTitle(title);

    const allRequirements = await prisma.requirement.findMany({
      select: { id: true, title: true, status: true, priority: true, createdAt: true },
    });

    const similar = allRequirements
      .map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        createdAt: r.createdAt,
        score: similarity(normalizedInput, normalizeTitle(r.title)),
      }))
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ success: true, data: similar, query: { title, threshold } });
  })
);

/**
 * GET /api/requirements/overdue
 * 查看超时需求列表（admin only）
 */
requirementsRouter.get(
  '/overdue',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await findOverdueRequirements();
    res.json({ success: true, data: result });
  })
);

/**
 * POST /api/requirements/overdue/notify
 * 手动触发催办通知（admin only）
 */
requirementsRouter.post(
  '/overdue/notify',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await runOverdueCheck();
    res.json({ success: true, data: result });
  })
);

/**
 * GET /api/requirements/kanban
 * 看板数据：按状态分组返回需求列表（admin 可见所有，其他人仅可见自己提交或分配的需求）
 */
requirementsRouter.get(
  '/kanban',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const where: Prisma.RequirementWhereInput = roleAwareRequirementWhere(actor);

    const requirements = await prisma.requirement.findMany({
      where,
      include: { tasks: true },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const grouped: Record<string, typeof requirements> = {
      pending: [],
      clarifying: [],
      'in-progress': [],
      testing: [],
      review: [],
      deploying: [],
      done: [],
      rejected: [],
    };

    for (const r of requirements) {
      const status = apiRequirementStatus[r.status as keyof typeof apiRequirementStatus] || r.status;
      if (!grouped[status]) grouped[status] = [];
      grouped[status].push(r);
    }

    // 转换为序列化格式
    const serialized: Record<string, unknown[]> = {};
    for (const [status, items] of Object.entries(grouped)) {
      serialized[status] = items.map(serializeRequirement);
    }

    res.json({
      data: serialized,
      meta: { total: requirements.length },
    });
  })
);

requirementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { query } = listRequirementsSchema.parse({ query: req.query });
    const actor = req.user!;
    const where: Prisma.RequirementWhereInput = {
      AND: [roleAwareRequirementWhere(actor)]
    };

    if (query.status) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { status: buildStatusData(query.status) }];
    }

    if (query.priority) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { priority: query.priority }];
    }

    if (query.search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { requester: { contains: query.search, mode: 'insensitive' } },
            { department: { contains: query.search, mode: 'insensitive' } },
            { assignee: { contains: query.search, mode: 'insensitive' } }
          ]
        }
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [requirements, total] = await prisma.$transaction([
      prisma.requirement.findMany({
        where,
        include: { tasks: true },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize
      }),
      prisma.requirement.count({ where })
    ]);

    res.json({
      data: requirements.map(serializeRequirement),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    });
  })
);

requirementsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { tasks: true }
    });

    if (!requirement) {
      throw new HttpError(404, '需求不存在');
    }

    if (!canReadRequirement(req.user!, requirement)) {
      throw new HttpError(403, '无权查看该需求');
    }

    res.json(serializeRequirement(requirement));
  })
);

// 获取需求修订历史
requirementsRouter.get(
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
        skip,
        take: query.pageSize,
        include: { operator: { select: { id: true, name: true } } },
      }),
      prisma.requirementRevision.count({ where: { requirementId: params.id } }),
    ]);

    res.json({
      data: revisions,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  })
);

requirementsRouter.patch(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params, body } = patchRequirementSchema.parse({
      params: req.params,
      body: req.body
    });

    const existing = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { tasks: true }
    });

    if (!existing) {
      throw new HttpError(404, '需求不存在');
    }

    // 权限检查：
    // - admin 可以做任何操作（审批、分配、改状态等）
    // - developer 只能更新分配给自己的需求，且只能改状态为 in-progress / testing
    if (req.user!.role !== 'admin') {
      // 非管理员：必须是 assignee 才能操作
      const isAssignee = existing.assigneeId === req.user!.id || existing.assignee === req.user!.name;
      if (!isAssignee) {
        throw new HttpError(403, '当前角色无权执行此操作');
      }
      // 非管理员只能改状态为 in-progress 或 testing
      const allowedStatuses = ['in-progress', 'testing'];
      if (body.status && !allowedStatuses.includes(body.status)) {
        throw new HttpError(403, '开发者只能将状态改为 in-progress 或 testing');
      }
      // 非管理员不能修改 assignee、rejectReason 等字段
      if (body.assignee !== undefined || body.rejectReason !== undefined) {
        throw new HttpError(403, '开发者不能修改分配人或拒绝原因');
      }
    }

    if (body.status === 'rejected' && !body.rejectReason) {
      throw new HttpError(400, '拒绝需求时必须填写拒绝原因');
    }

    // 强制逐步流转校验
    if (body.status) {
      const currentStatus = apiRequirementStatus[existing.status as keyof typeof apiRequirementStatus] as string;
      if (!isValidTransition(currentStatus, body.status)) {
        const allowed = VALID_TRANSITIONS[currentStatus] || [];
        throw new HttpError(
          400,
          `状态流转不合法：当前「${currentStatus}」不可直接流转到「${body.status}」，合法目标：[${allowed.join(', ')}]`,
        );
      }
    }

    // 硬性验收约束：流转到 testing/review/deploying/done 必须有对应的报告
    // - testing: 允许 pending 报告（开发者提交报告后即可流转）
    // - review/deploying/done: 必须 approved 报告
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
      // 如果指定了 assignee，查找对应的 userId
      let assigneeId = existing.assigneeId;
      if (body.assignee && body.assignee !== existing.assignee) {
        const assigneeUser = await tx.user.findFirst({
          where: {
            OR: [{ name: body.assignee }, { email: body.assignee }]
          },
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

      // 自动记录修订历史
      await tx.requirementRevision.create({
        data: {
          requirementId: params.id,
          title: existing.title,
          description: existing.description,
          priority: existing.priority,
          status: existing.status,
          requester: existing.requester,
          department: existing.department,
          assignee: existing.assignee,
          dueDate: existing.dueDate,
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
      id: updated.id,
      title: updated.title,
      status: body.status,
      actor: req.user!.name,
      assignee: updated.assignee,
      requesterId: updated.requesterId,
      assigneeId: updated.assigneeId
    });

    res.json(serializeRequirement(updated));
  })
);

requirementsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = updateRequirementSchema.parse({
      params: req.params,
      body: req.body
    });

    const existing = await prisma.requirement.findUnique({
      where: { id: params.id }
    });

    if (!existing) {
      throw new HttpError(404, '需求不存在');
    }

    if (!canEditRequirement(req.user!, existing)) {
      throw new HttpError(403, '无权编辑该需求');
    }

    // 解析 assignee 对应的 userId
    let assigneeId = existing.assigneeId;
    if (body.assignee !== undefined) {
      if (body.assignee) {
        const assigneeUser = await prisma.user.findFirst({
          where: {
            OR: [{ name: body.assignee }, { email: body.assignee }]
          },
          select: { id: true }
        });
        assigneeId = assigneeUser?.id ?? null;
      } else {
        assigneeId = null;
      }
    }

    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        requester: body.requester,
        department: body.department,
        assignee: body.assignee,
        assigneeId,
        dueDate: body.dueDate,
        attachment: body.attachment
      },
      include: { tasks: true }
    });

    // 自动记录修订历史
    await prisma.requirementRevision.create({
      data: {
        requirementId: params.id,
        title: existing.title,
        description: existing.description,
        priority: existing.priority,
        status: existing.status,
        requester: existing.requester,
        department: existing.department,
        assignee: existing.assignee,
        dueDate: existing.dueDate,
        attachment: existing.attachment,
        revisionNote: '内容已编辑更新',
        operatorId: req.user!.id,
      }
    });

    void notifyEvent('requirement.updated', {
      id: updated.id,
      title: updated.title,
      actor: req.user!.name,
      assignee: updated.assignee
    });

    res.json(serializeRequirement(updated));
  })
);

// ===== P1 批量审批 =====
const batchStatusSchema = z.object({
  body: z.object({
    ids: z.array(z.string().uuid()).min(1).max(50),
    status: z.enum(['pending', 'clarifying', 'approved', 'rejected', 'in-progress', 'testing', 'review', 'deploying', 'done']),
    rejectReason: z.string().trim().optional()
  })
});

requirementsRouter.post(
  '/batch-status',
  requireRoles('admin'),
  asyncHandler(async (req, res) => {
    const { body } = batchStatusSchema.parse({ body: req.body });

    const requirements = await prisma.requirement.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, title: true, status: true, assignee: true, tasks: true }
    });

    if (requirements.length !== body.ids.length) {
      throw new HttpError(400, '部分需求不存在');
    }

    if (body.status === 'rejected' && !body.rejectReason) {
      throw new HttpError(400, '批量拒绝时必须填写拒绝原因');
    }

    if (['testing', 'review', 'deploying', 'done'].includes(body.status)) {
      for (const item of requirements) {
        const allowPending = body.status === 'testing';
        const { ok, missing } = await checkAcceptanceReports(item.id, body.status as RequirementStatusApi, allowPending);
        if (!ok) {
          throw new HttpError(400, `「${item.title}」缺少验收报告，无法批量流转到「${body.status}」`);
        }
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
            requirementId: item.id,
            title: item.title,
            description: '',
            priority: 'P2',
            status: item.status,
            requester: '',
            department: '',
            assignee: item.assignee,
            revisionNote: `批量状态变更: ${body.status}`,
            operatorId,
          }
        });
      }
      return tx.requirement.findMany({
        where: { id: { in: body.ids } },
        include: { tasks: true }
      });
    });

    res.json({ success: true, count: updated.length });
  })
);

// ===== P2 用户列表 =====
requirementsRouter.get(
  '/users/list',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ data: users });
  })
);

// POST /api/requirements/:id/attachments - Upload requirement attachments
requirementsRouter.post(
  '/:id/attachments',
  authRequired,
  requirementUpload.array('files', 10),
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    const files = Array.isArray(req.files) ? req.files : [];
    const movedFilePaths: string[] = [];

    try {
      await ensureReadableRequirement(params.id, req.user!);

      if (files.length === 0) {
        throw new HttpError(400, '请选择要上传的文件');
      }

      const requirementUploadPath = getRequirementUploadPath(params.id);
      mkdirSync(requirementUploadPath, { recursive: true });

      const attachments = files.map((file) => {
        const filename = file.filename as string;
        if (!isAllowedRequirementUploadFilename(filename)) {
          throw new HttpError(400, '无效的文件名');
        }

        const targetPath = getRequirementAttachmentPath(params.id, filename);
        renameSync(file.path, targetPath);
        movedFilePaths.push(targetPath);

        return {
          filename,
          originalName: file.originalname,
          url: getRequirementUploadUrl(path.join(params.id, filename)),
          size: Number(file.size),
          mimeType: getRequirementUploadMimeType(filename) || file.mimetype
        };
      });

      res.status(201).json({ data: attachments });
    } catch (err) {
      removeTemporaryRequirementUploads(files);
      for (const movedFilePath of movedFilePaths) {
        try {
          unlinkSync(movedFilePath);
        } catch {
          // Ignore cleanup errors; the main request error is more relevant.
        }
      }
      throw err;
    }
  })
);

// GET /api/requirements/:id/attachments - List requirement attachments
requirementsRouter.get(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    await ensureReadableRequirement(params.id, req.user!);

    const requirementUploadPath = getRequirementUploadPath(params.id);
    let filenames: string[];

    try {
      filenames = readdirSync(requirementUploadPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.json({ data: [] });
        return;
      }
      throw err;
    }

    const attachments: Array<NonNullable<ReturnType<typeof serializeRequirementAttachment>>> = [];
    for (const filename of filenames) {
      if (!isAllowedRequirementUploadFilename(filename)) {
        continue;
      }

      try {
        const attachment = serializeRequirementAttachment(params.id, filename);
        if (attachment) {
          attachments.push(attachment);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw err;
      }
    }

    res.json({ data: attachments });
  })
);

// GET /api/requirements/:id/attachments/:filename - Download a requirement attachment
requirementsRouter.get(
  '/:id/attachments/:filename',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    await ensureReadableRequirement(params.id, req.user!);

    const filenameStr = req.params.filename as string;
    if (!isAllowedRequirementUploadFilename(filenameStr)) {
      throw new HttpError(400, '无效的文件名');
    }

    const filePath = getRequirementAttachmentPath(params.id, filenameStr);
    const mimeType = getRequirementUploadMimeType(filenameStr);

    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        throw new HttpError(404, '文件不存在');
      }

      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filenameStr)}"`);

      const fileStream = createReadStream(filePath);
      fileStream.pipe(res);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new HttpError(404, '文件不存在');
      }
      throw err;
    }
  })
);

// DELETE /api/requirements/:id/attachments/:filename - Delete a requirement attachment
requirementsRouter.delete(
  '/:id/attachments/:filename',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    await ensureReadableRequirement(params.id, req.user!);

    const filenameStr = req.params.filename as string;
    if (!isAllowedRequirementUploadFilename(filenameStr)) {
      throw new HttpError(400, '无效的文件名');
    }

    const filePath = getRequirementAttachmentPath(params.id, filenameStr);

    try {
      unlinkSync(filePath);
      res.json({ success: true, filename: filenameStr });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new HttpError(404, '文件不存在');
      }
      throw err;
    }
  })
);
