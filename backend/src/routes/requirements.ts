import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
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
  'pending':     ['approved', 'rejected'],
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
): Promise<{ ok: boolean; missing: string[] }> {
  const required = getRequiredReports(targetStatus);

  if (required.length === 0) return { ok: true, missing: [] };

  const approvedReports = await prisma.requirementReport.findMany({
    where: {
      requirementId,
      reportType: { in: required },
      status: 'approved',
    },
    select: { reportType: true },
  });

  const approvedTypes = new Set(approvedReports.map((r) => r.reportType));
  const missing = required.filter((t) => !approvedTypes.has(t));

  return { ok: missing.length === 0, missing };
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
        assignee: body.assignee,
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
  requireRoles('admin', 'developer'),
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

    if (req.user!.role === 'developer' && !canReadRequirement(req.user!, existing)) {
      throw new HttpError(403, '无权更新该需求');
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

    // 硬性验收约束：流转到 testing/review/deploying/done 必须有对应的 approved 报告
    if (body.status && ['testing', 'review', 'deploying', 'done'].includes(body.status)) {
      const { ok, missing } = await checkAcceptanceReports(params.id, body.status as RequirementStatusApi);
      if (!ok) {
        const reportTypeLabels: Record<string, string> = {
          DEV_SELF_CHECK: '开发自检报告',
          SECURITY_REVIEW: '安全检查报告',
          TEST_REPORT: '测试报告',
          CTO_REVIEW: 'CTO验收报告',
          DEPLOY_CONFIRM: '发布确认报告',
        };
        const missingLabels = missing.map((t) => reportTypeLabels[t] ?? t).join('、');
        throw new HttpError(
          400,
          `验收约束：流转到「${body.status}」前，必须有以下已通过的报告：${missingLabels}`,
        );
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
    status: z.enum(['pending', 'approved', 'rejected', 'in-progress', 'testing', 'review', 'deploying', 'done']),
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
        const { ok, missing } = await checkAcceptanceReports(item.id, body.status as RequirementStatusApi);
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
