import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { InternalRole, RequirementPriority, ReportType, ReportStatus } from '@prisma/client';
import { HttpError } from '../utils/http-error.js';
import { prisma } from '../lib/prisma.js';
import { hasPlatformRole } from '../lib/platform-roles.js';

/**
 * P0 需求内部角色中间件
 * 需求ID: 68e2a748-4bee-4973-80cb-18dd075c97f9
 *
 * 强制规则：
 * 1. 需求提交者不能自己审批
 * 2. TEST_REPORT/SECURITY_REVIEW 先经 QA 再 CTO
 * 3. WIP 超限拒绝分配 (默认 ≤2)
 * 4. P0-P1 需求必须先经 PM 审核
 */

// ─── 类型扩展 ───────────────────────────────────────────────

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      name: string;
      email: string;
      role: string;
      internalRole?: InternalRole;
      roles?: string[];
    }
  }
}

// ─── 中间件：检查内部角色 ───────────────────────────────────

export function requireInternalRole(...roles: InternalRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new HttpError(401, '请先登录'));
    }

    const hasRequiredRole = roles.some(role => hasPlatformRole(req.user!, role));
    if (!hasRequiredRole && !req.user.internalRole && (!req.user.roles || req.user.roles.length === 0)) {
      return next(new HttpError(403, '当前用户未分配内部角色，请联系管理员'));
    }

    if (!hasRequiredRole) {
      return next(new HttpError(403, `需要 ${roles.join(' 或 ')} 权限`));
    }

    return next();
  };
}

// ─── 中间件：检查 PM 审批要求 ───────────────────────────────

export async function requirePmApproval(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, '请先登录'));

  // 从 params 或 body 获取 requirementId
  const requirementId = req.params.id || req.body.requirementId;
  if (!requirementId || typeof requirementId !== 'string') {
    return next(); // 跳过，没有 requirementId
  }

  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { priority: true, pmApprovedAt: true, pmApprovedBy: true },
  });

  if (!requirement) {
    return next(new HttpError(404, '需求不存在'));
  }

  // P0-P1 必须先经 PM 审批
  const needsPmApproval = requirement.priority === RequirementPriority.P0 ||
                          requirement.priority === RequirementPriority.P1;

  if (needsPmApproval && !requirement.pmApprovedAt) {
    return next(new HttpError(403, 'P0/P1 需求必须先经 PM 审批才能分配开发'));
  }

  return next();
}

// ─── 中间件：检查 WIP 限制 ───────────────────────────────────

const DEFAULT_WIP_LIMIT = 2;
const WIP_LIMIT = parseInt(process.env.WIP_LIMIT || String(DEFAULT_WIP_LIMIT), 10);

export async function checkWipLimit(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, '请先登录'));

  const assigneeId = req.body.assigneeId;
  if (!assigneeId) {
    return next(); // 没有分配给任何人，跳过
  }

  // 检查当前 in-progress 需求数量
  const inProgressCount = await prisma.requirement.count({
    where: {
      assigneeId,
      currentStep: { not: 'done' },
    },
  });

  if (inProgressCount >= WIP_LIMIT) {
    return next(new HttpError(403, `当前开发已有 ${inProgressCount} 个进行中的需求，已达 WIP 上限 (${WIP_LIMIT})，请完成现有任务后再分配新需求`));
  }

  return next();
}

// ─── 中间件：防止自我审批 ───────────────────────────────────

export async function preventSelfApproval(
  req: Request,
  _res: Response,
  next: NextFunction,
  requesterId: string | null | undefined
) {
  if (requesterId && requesterId === req.user?.id) {
    return next(new HttpError(403, '需求提交者不能审批自己的需求'));
  }
  return next();
}

// ─── 中间件：报告审查流程控制 ───────────────────────────────

export async function enforceReportReviewFlow(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, '请先登录'));

  const reportId = req.params.id || req.body.reportId;
  if (!reportId || typeof reportId !== 'string') {
    return next(); // 没有 reportId，跳过
  }

  const report = await prisma.requirementReport.findUnique({
    where: { id: reportId },
    select: { reportType: true, qaReviewedAt: true, qaReviewedBy: true, status: true },
  });

  if (!report) {
    return next(new HttpError(404, '报告不存在'));
  }

  // TEST_REPORT 和 SECURITY_REVIEW 必须先经 QA 审查（qa_bypass 已删除）
  const requiresQaReview = report.reportType === ReportType.TEST_REPORT ||
                          report.reportType === ReportType.SECURITY_REVIEW;

  if (requiresQaReview) {
    const hasQaClearance = Boolean(report.qaReviewedAt);

    // 非 QA 角色尝试审批
    if (!hasPlatformRole(req.user, InternalRole.qa) && !hasQaClearance) {
      return next(new HttpError(403, '测试报告和安全审查必须先经 QA 审查，再由 CTO 最终审批'));
    }

    // QA 已经审查，现在由 CTO 审批
    if (hasPlatformRole(req.user, InternalRole.cto) && !hasQaClearance) {
      return next(new HttpError(403, '请先由 QA 进行审查，CTO 才能最终审批'));
    }
  }

  return next();
}

// ─── 工具函数：获取用户 WIP 计数 ───────────────────────────

export async function getWipCount(userId: string): Promise<number> {
  return await prisma.requirement.count({
    where: {
      assigneeId: userId,
      currentStep: { not: 'done' },
    },
  });
}

// ─── 工具函数：检查是否需要 PM 审批 ───────────────────────

export function needsPmApproval(priority: RequirementPriority): boolean {
  return priority === RequirementPriority.P0 || priority === RequirementPriority.P1;
}
