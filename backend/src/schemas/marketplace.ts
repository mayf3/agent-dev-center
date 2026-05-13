import { z } from 'zod';

const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)])
);

const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return new Date(String(value));
}, z.date().optional());

const optionalTrimmedString = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value).trim();
}, z.string().optional());

const agentName = z.string().trim().min(2).max(80);
const marketplaceAgentStatus = z.enum(['active', 'inactive', 'maintenance']);
const marketplaceTaskStatus = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']);
const marketplacePriority = z.enum(['low', 'normal', 'high', 'urgent']);
const deliverableType = z.enum(['text', 'image', 'document', 'url', 'file']);

const createAgentBody = z.object({
  name: agentName,
  displayName: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2),
  avatar: optionalTrimmedString,
  capabilities: z.array(jsonValue).default([]),
  apiEndpoint: optionalTrimmedString
});

export const createAgentSchema = z.object({
  body: createAgentBody
});

export const updateAgentSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  }),
  body: createAgentBody
    .partial()
    .extend({
      status: marketplaceAgentStatus.optional()
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: '至少提供一个要更新的字段'
    })
});

export const createTaskSchema = z.object({
  body: z.object({
    agentName,
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().min(2),
    input: jsonValue.optional(),
    priority: marketplacePriority.default('normal'),
    deadline: optionalDate
  })
});

export const updateTaskSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  }),
  body: z
    .object({
      status: marketplaceTaskStatus.optional(),
      startedAt: optionalDate,
      completedAt: optionalDate,
      errorMsg: optionalTrimmedString
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: '至少提供一个要更新的字段'
    })
});

export const createDeliverableSchema = z.object({
  params: z.object({
    taskId: z.string().uuid()
  }),
  body: z.object({
    type: deliverableType,
    title: optionalTrimmedString,
    content: z.string().trim().min(1),
    metadata: jsonValue.optional()
  })
});

export const marketplaceIdSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});

export const marketplaceTaskIdSchema = z.object({
  params: z.object({
    taskId: z.string().uuid()
  })
});

export const listAgentsSchema = z.object({
  query: z.object({
    status: marketplaceAgentStatus.optional()
  })
});

export const listMarketplaceTasksSchema = z.object({
  query: z.object({
    agentId: z.string().uuid().optional(),
    status: marketplaceTaskStatus.optional(),
    requesterId: z.string().uuid().optional(),
    priority: marketplacePriority.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20)
  })
});

export const claimMarketplaceTaskSchema = z.object({
  body: z.object({
    agentName
  })
});
