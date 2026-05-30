import { z } from 'zod';

export const assignWorkflowSchema = z.object({
  body: z.object({
    workflowName: z.string().min(1, '工作流名称不能为空'),
  }),
});

export const advanceStepSchema = z.object({
  body: z.object({
    comment: z.string().trim().max(2000).optional(),
  }),
});

export const rejectStepSchema = z.object({
  body: z.object({
    comment: z.string().trim().min(1, '回退原因不能为空').max(2000),
  }),
});

export const workflowTemplateIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});
