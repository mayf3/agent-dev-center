import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { prismaRequirementStatus, type RequirementStatusApi } from '../../utils/status.js';
import {
  getRequirementUploadMimeType,
  getRequirementUploadPath,
  getRequirementUploadUrl,
  isAllowedRequirementUploadFilename
} from '../../lib/multer.js';
import { createReadStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** 权限判断：是否可查看该需求（基于 user.id） */
export function canReadRequirement(user: Express.AuthUser, requirement: { requesterId: string | null; requester: string; assigneeId: string | null; assignee: string | null }) {
  if (user.role === 'admin' || user.role === 'cto_agent') {
    return true;
  }

  if (user.role === 'requester') {
    return requirement.requesterId === user.id ||
           requirement.requester === user.name ||
           requirement.requester === user.email;
  }

  return requirement.assigneeId === user.id ||
         requirement.assignee === user.name ||
         requirement.assignee === user.email;
}

/** 权限判断：是否可编辑该需求（基于 user.id） */
export function canEditRequirement(user: Express.AuthUser, requirement: {
  requesterId: string | null;
  requester: string;
  assigneeId: string | null;
  assignee: string | null;
  status: unknown;
}) {
  if (user.role === 'admin' || user.role === 'cto_agent') {
    return true;
  }

  const isRequester = requirement.requesterId === user.id || requirement.requester === user.name;
  if (isRequester && ['pending', 'rejected'].includes(String(requirement.status))) {
    return true;
  }

  const isAssignee = requirement.assigneeId === user.id ||
    requirement.assignee === user.name ||
    requirement.assignee === user.email;
  if (isAssignee && !['done', 'cancelled'].includes(String(requirement.status))) {
    return true;
  }

  return false;
}

/** 基于角色过滤查询条件（使用 user.id） */
export function roleAwareRequirementWhere(user: Express.AuthUser): Prisma.RequirementWhereInput {
  if (user.role === 'admin' || user.role === 'cto_agent' || user.internalRole === 'pm') {
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

export function buildStatusData(status?: RequirementStatusApi) {
  return status ? prismaRequirementStatus[status] : undefined;
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
