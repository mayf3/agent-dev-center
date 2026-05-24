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
import { archiveFile } from '../lib/archive.js';
import { listRevisionsSchema } from '../schemas/revision.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../utils/similarity.js';
import { runOverdueCheck, findOverdueRequirements } from '../utils/overdue-check.js';
import {
  requireInternalRole,
  requirePmApproval,
  checkWipLimit,
  preventSelfApproval,
  enforceReportReviewFlow
} from '../middleware/internal-workflow.js';

export const requirementsRouter = Router();

requirementsRouter.use(authRequired);

/** 权限判断：是否可查看该需求（基于 user.id） */
function canReadRequirement(user: Express.AuthUser, requirement: { requesterId: string | null; requester: string; assigneeId: string | null; assignee: string | null }) {
  if (user.role === 'admin' || user.role === 'cto_agent') {
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
  if (user.role === 'admin' || user.role === 'cto_agent') {
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
  if (user.role === 'admin' || user.role === 'cto_agent') {
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


export interface DecomposedTask {
  title: string;
  description: string;
  priority: string;
  assignee: string | null;
  estimated_hours: number | null;
  depends_on: number[];
}
