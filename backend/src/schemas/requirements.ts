import { z } from 'zod';
import { requirementStatusValues } from '../utils/status.js';

const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return new Date(String(value));
}, z.date().optional());

const nullableString = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  // 空字符串表示主动清空（如清空 assignee），保留为 null
  if (value === '') {
    return null;
  }

  return String(value).trim();
}, z.string().nullable().optional());

export const createRequirementSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().min(5),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
    type: z.enum(['FEATURE', 'BUGFIX', 'POSTMORTEM', 'INFRA', 'SECURITY']).default('FEATURE'),
    tags: z.array(z.string().trim().max(50)).max(10).default([]),
    requester: z.string().trim().min(2).max(60).optional(),
    department: z.string().trim().min(2).max(80),
    assignee: nullableString,
    dueDate: optionalDate,
    attachment: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
    repoPath: z.string().trim().max(500).optional(),   // 4397e6a9: 代码仓库路径
    branch: z.string().trim().max(200).optional()      // 4397e6a9: Git 分支名
  })
});

export const listRequirementsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(10),
    currentStep: z.string().trim().min(1).max(80).optional(),
    status: z.enum(requirementStatusValues).optional(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
    type: z.enum(['FEATURE', 'BUGFIX', 'POSTMORTEM', 'INFRA', 'SECURITY']).optional(),
    tags: z.preprocess(
      (v) => (typeof v === 'string' ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : v),
      z.array(z.string()).optional()
    ),
    search: z.string().trim().max(100).optional()
  })
});

export const requirementIdSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});

export const patchRequirementSchema = requirementIdSchema.extend({
  body: z
    .object({
      currentStep: z.string().trim().min(1).max(80).optional(),
      status: z.enum(requirementStatusValues).optional(),
      assignee: nullableString,
      rejectReason: nullableString,
      gitHash: z.string().trim().optional(),
      deployVersion: z.string().trim().optional(),
      repoPath: z.string().trim().max(500).optional(),   // 4397e6a9
      branch: z.string().trim().max(200).optional(),     // 4397e6a9
      workflowId: z.string().trim().optional()
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: '至少提供一个要更新的字段'
    })
});

export const updateRequirementSchema = requirementIdSchema.extend({
  body: z
    .object({
      title: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().min(5).optional(),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
      type: z.enum(['FEATURE', 'BUGFIX', 'POSTMORTEM', 'INFRA', 'SECURITY']).optional(),
      tags: z.array(z.string().trim().max(50)).max(10).optional(),
      requester: z.string().trim().min(2).max(60).optional(),
      department: z.string().trim().min(2).max(80).optional(),
      assignee: nullableString,
      dueDate: optionalDate,
      attachment: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
      notes: z.string().optional(),
      repoPath: z.string().trim().max(500).optional(),   // 4397e6a9
      branch: z.string().trim().max(200).optional()      // 4397e6a9
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: '至少提供一个要更新的字段'
    })
});
