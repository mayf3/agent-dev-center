import { z } from 'zod';

export const sessionStatusValues = ['running', 'completed', 'failed', 'cancelled'] as const;
export const traceKindValues = ['command', 'output', 'error', 'api_call', 'system'] as const;
export const traceLevelValues = ['info', 'warn', 'error', 'debug'] as const;

// 创建 Session
export const createSessionSchema = z.object({
  body: z.object({
    taskId: z.string().uuid().optional(),
    requirementId: z.string().uuid().optional(),
    agentName: z.string().trim().min(1).max(255),
    agentEmail: z.string().email(),
    metadata: z.record(z.any()).optional()
  }).refine(data => data.taskId || data.requirementId, {
    message: 'taskId 或 requirementId 至少需要一个'
  })
});

// 添加 Trace
export const addTraceSchema = z.object({
  params: z.object({
    sessionId: z.string().uuid()
  }),
  body: z.object({
    kind: z.enum(traceKindValues).default('system'),
    level: z.enum(traceLevelValues).default('info'),
    content: z.string(),
    metadata: z.record(z.any()).optional(),
    durationMs: z.number().int().optional()
  })
});

// 完成 Session
export const completeSessionSchema = z.object({
  params: z.object({
    sessionId: z.string().uuid()
  }),
  body: z.object({
    status: z.enum(sessionStatusValues).default('completed'),
    exitCode: z.number().int().optional(),
    errorMessage: z.string().optional()
  })
});

// 查询 Sessions
export const listSessionsSchema = z.object({
  query: z.object({
    taskId: z.string().uuid().optional(),
    requirementId: z.string().uuid().optional(),
    agentName: z.string().trim().max(255).optional(),
    status: z.enum(sessionStatusValues).optional(),
    limit: z.string().regex(/^\d+$/).default('50'),
    offset: z.string().regex(/^\d+$/).default('0')
  })
});

// 重试 Session
export const retrySessionSchema = z.object({
  params: z.object({
    sessionId: z.string().uuid()
  })
});
