import { z } from 'zod';

const optionalTrimmedString = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value).trim();
}, z.string().optional());

const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return new Date(String(value));
}, z.date().optional());

const serviceStatus = z.enum(['online', 'offline', 'maintenance', 'unknown']);

const createServiceBody = z.object({
  name: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2),
  port: z.number().int().positive().optional(),
  localUrl: optionalTrimmedString,
  remoteUrl: optionalTrimmedString,
  techStack: z.array(z.string()).default([]),
  owner: optionalTrimmedString,
  gitRepo: optionalTrimmedString,
  database: optionalTrimmedString,
  version: optionalTrimmedString,
  lastDeployedAt: optionalDate,
});

export const createServiceSchema = z.object({
  body: createServiceBody,
});

export const updateServiceSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: createServiceBody
    .partial()
    .extend({
      status: serviceStatus.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: '至少提供一个要更新的字段',
    }),
});

export const serviceIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const listServicesSchema = z.object({
  query: z.object({
    status: serviceStatus.optional(),
    owner: z.string().trim().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});
