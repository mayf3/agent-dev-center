import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import {
  getRequirementUploadMimeType,
  getRequirementUploadPath,
  getRequirementUploadUrl,
  isAllowedRequirementUploadFilename
} from '../../lib/multer.js';
import { createReadStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** 权限判断：是否可查看该需求（基于 user.id）
 *
 * 2026-06-04 修复：QA/tester/security/ops 角色可查看所有需求。
 * 这些角色是工作流的审批者/执行者，不应该被 assignee 限制。
 *
 * 2026-06-04 安全更新：需求可见性与操作权限控制（P1 需求 ef8419f2）
 * - developer（internalRole 或 role）按 assigneeId 判断
 */
export function canReadRequirement(user: Express.AuthUser, requirement: { requesterId: string | null; requester: string; assigneeId: string | null; assignee: string | null }) {
  if (user.role === 'admin' || user.role === 'cto_agent' || user.internalRole === 'cto') {
    return true;
  }

  // 工作流审批角色：可查看所有需求
  if (user.internalRole === 'qa' || user.internalRole === 'tester' || user.internalRole === 'security' || user.internalRole === 'ops') {
    return true;
  }

  // 开发者：只看分配给自己的
  if (user.internalRole === 'developer' || user.role === 'developer') {
    return requirement.assigneeId === user.id ||
           (requirement.assignee === user.name || requirement.assignee === user.email);
  }

  // 纯 requester：只看自己提的
  if (user.role === 'requester') {
    return requirement.requesterId === user.id ||
           requirement.requester === user.name ||
           requirement.requester === user.email;
  }

  // 默认：按 assignee 判断
  return requirement.assigneeId === user.id ||
         (requirement.assignee === user.name || requirement.assignee === user.email);
}

/** 权限判断：是否可编辑该需求（基于 user.id） */
export function canEditRequirement(user: Express.AuthUser, requirement: {
  requesterId: string | null;
  requester: string;
  assigneeId: string | null;
  assignee: string | null;
  currentStep: string | null;
}) {
  if (user.role === 'admin' || user.role === 'cto_agent') {
    return true;
  }

  const isRequester = requirement.requesterId === user.id || requirement.requester === user.name;
  const currentStep = requirement.currentStep ?? 'pending';
  if (isRequester && ['pending', 'rejected'].includes(currentStep)) {
    return true;
  }

  const isAssignee = requirement.assigneeId === user.id ||
    requirement.assignee === user.name ||
    requirement.assignee === user.email;
  if (isAssignee && !['done', 'cancelled'].includes(currentStep)) {
    return true;
  }

  return false;
}

/** 基于角色过滤查询条件（使用 user.id）
 *
 * 2026-06-04 修复：QA/tester/security/ops 角色应该能看到所有有工作流步骤的需求，
 * 因为他们需要审查报告、审批流程。之前只看 assignee=自己的逻辑导致
 * QA 完全看不到任何需求（工作流中从没有 QA 作为 assignee）。
 *
 * 2026-06-04 安全更新：需求可见性与操作权限控制（P1 需求 ef8419f2）
 * - admin/cto/pm → 看所有
 * - developer（internalRole 或 role） → 只看 assignee=自己的需求
 * - requester（role=requester 且无 internalRole） → 只看自己提的
 * - qa/tester/security/ops → 看所有（工作流审批者）
 */
export function roleAwareRequirementWhere(user: Express.AuthUser): Prisma.RequirementWhereInput {
  // 管理层：看所有（admin/cto_agent/pm/cto）
  if (user.role === 'admin' || user.role === 'cto_agent' || user.internalRole === 'pm' || user.internalRole === 'cto') {
    return {};
  }

  // 工作流审批角色：看所有需求（他们是工作流的审批者/执行者，不是需求执行者）
  if (user.internalRole === 'qa' || user.internalRole === 'tester' || user.internalRole === 'security' || user.internalRole === 'ops') {
    return {};
  }

  // 开发者（internalRole=developer 或 role=developer）：只看分配给自己的
  if (user.internalRole === 'developer' || user.role === 'developer') {
    return {
      OR: [{ assigneeId: user.id }, { assignee: user.name }, { assignee: user.email }]
    };
  }

  // 纯 requester（无 internalRole 或 internalRole=普通用户）：只看自己提的
  if (user.role === 'requester') {
    return {
      OR: [{ requesterId: user.id }, { requester: user.name }, { requester: user.email }]
    };
  }

  // 默认：只看自己提的（安全兜底）
  return {
    OR: [{ requesterId: user.id }, { requester: user.name }, { requester: user.email }]
  };
}

export async function ensureReadableRequirement(requirementId: string, user: Express.AuthUser) {
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

export function getRequirementAttachmentPath(requirementId: string, filename: string): string {
  return getRequirementUploadPath(path.join(requirementId, filename));
}

export function serializeRequirementAttachment(requirementId: string, filename: string) {
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

export function removeTemporaryRequirementUploads(files: Express.Multer.File[]) {
  for (const file of files) {
    try {
      unlinkSync(file.path);
    } catch {
      // Ignore cleanup errors
    }
  }
}
