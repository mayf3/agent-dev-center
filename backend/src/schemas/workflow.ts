import { z } from 'zod';

export const assignWorkflowSchema = z.object({
  body: z.object({
    workflowName: z.string().min(1, '工作流名称不能为空'),
    startStep: z.string().optional(),
  }),
});

const executionSchema = z.object({
  leaseId: z.string().uuid(),
  sessionId: z.string().trim().min(1).max(255),
  idempotencyKey: z.string().trim().min(1).max(255)
    .refine(k => !k.startsWith('system:'), { message: 'idempotencyKey cannot start with system:' }),
  expectedStateVersion: z.number().int().nonnegative(),
});

export const advanceStepSchema = z.object({
  body: z.object({
    comment: z.string().trim().max(2000).optional(),
    branch: z.string().trim().max(100).optional(),
    execution: executionSchema.optional(),
  }),
});

export const rejectStepSchema = z.object({
  body: z.object({
    comment: z.string().trim().min(1, '回退原因不能为空').max(2000),
    targetStep: z.string().trim().optional(),
    execution: executionSchema.optional(),
  }),
});

export const pmApproveStepSchema = advanceStepSchema;

export const pmRejectStepSchema = z.object({
  body: z.object({
    comment: z.string().trim().min(1, '驳回原因不能为空').max(2000),
  }),
});

export const workflowTemplateIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});
