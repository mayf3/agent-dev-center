import { z } from 'zod';

const optionalTrimmedString = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v).trim();
}, z.string().optional());

export const registerAgentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(80),
    displayName: z.string().trim().min(2).max(120),
    description: z.string().trim().min(2),
    avatar: optionalTrimmedString,
    capabilities: z.array(z.record(z.unknown())).default([]),
    apiEndpoint: optionalTrimmedString,
    notificationType: z.enum(['webhook', 'feishu', 'polling']).default('polling'),
    feishuWebhookUrl: z.string().url().optional().or(z.literal('')),
    tags: z.array(z.string()).default([]),
  }),
});

export const taskCallbackSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    status: z.enum(['completed', 'failed']),
    deliverables: z
      .array(
        z.object({
          type: z.enum(['text', 'image', 'document', 'url', 'file']),
          title: optionalTrimmedString,
          content: z.string().min(1),
          metadata: z.record(z.unknown()).optional(),
        })
      )
      .default([]),
    errorMsg: optionalTrimmedString,
    executionTimeMs: z.number().int().positive().optional(),
    tokensUsed: z.number().int().positive().optional(),
  }),
});

export const heartbeatSchema = z.object({
  body: z.object({
    status: z.enum(['active', 'idle', 'busy']).optional(),
  }),
});

export const rankingsSchema = z.object({
  query: z.object({
    days: z.coerce.number().int().positive().default(30),
    limit: z.coerce.number().int().positive().max(50).default(20),
  }),
});
