import { z } from 'zod';
import { requirementStatusValues } from '../utils/status.js';

const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return new Date(String(value));
}, z.date().optional());

const nullableString = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value).trim();
}, z.string().optional());

export const createRequirementSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().min(5),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
    requester: z.string().trim().min(2).max(60).optional(),
    department: z.string().trim().min(2).max(80),
    assignee: nullableString,
    dueDate: optionalDate,
    attachment: z.string().trim().url().optional().or(z.literal('').transform(() => undefined))
  })
});

export const listRequirementsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(10),
    status: z.enum(requirementStatusValues).optional(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
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
      status: z.enum(requirementStatusValues).optional(),
      assignee: nullableString,
      rejectReason: nullableString,
      gitHash: z.string().trim().optional(),
      deployVersion: z.string().trim().optional()
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
      requester: z.string().trim().min(2).max(60).optional(),
      department: z.string().trim().min(2).max(80).optional(),
      assignee: nullableString,
      dueDate: optionalDate,
      attachment: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
      notes: z.string().optional()
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: '至少提供一个要更新的字段'
    })
});
