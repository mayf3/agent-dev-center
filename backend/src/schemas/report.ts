import { z } from 'zod';

export const reportTypeValues = [
  'DEV_SELF_CHECK',
  'SECURITY_REVIEW',
  'TEST_REPORT',
  'CTO_REVIEW',
  'ARCH_DESIGN',
  'ARCH_REVIEW',
  'TEST_DEPLOY_CONFIRM',
  'DEPLOY_CONFIRM',
  'POSTMORTEM',
  'MERGE_REPORT',
] as const;

export const reportStatusValues = [
  'pending',
  'approved',
  'rejected',
  'changes_requested',
] as const;

export const submitReportSchema = z.object({
  params: z.object({ id: z.string().min(1).optional() }),
  body: z.object({
    requirementId: z.string().min(1).optional(),  // autoRegisterRoutes 兼容：平路路径时从 body 传递
    reportType: z.enum(reportTypeValues),
    content: z.record(z.unknown()),
    submittedBy: z.string().min(1).optional(),
  }),
});

export const listReportsSchema = z.object({
  params: z.object({ id: z.string().min(1).optional() }),  // autoRegisterRoutes 兼容：平路路径时可为空
  query: z.object({
    requirementId: z.string().min(1).optional(),
    reportType: z.enum(reportTypeValues).optional(),
    status: z.enum(reportStatusValues).optional(),
  }),
});

export const reviewReportSchema = z.object({
  params: z.object({ id: z.string().min(1).optional(), reportId: z.string().min(1) }),
  body: z.object({
    status: z.enum(['approved', 'rejected', 'changes_requested']),
    reviewComment: z.string().max(2000).optional(),
    qa_bypass: z.boolean().optional(),
    qa_bypass_reason: z.string().trim().min(10).max(500).optional(),
  }).superRefine((body, ctx) => {
    if (body.qa_bypass === true && !body.qa_bypass_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['qa_bypass_reason'],
        message: 'qa_bypass=true 时必须提供 qa_bypass_reason',
      });
    }
  }),
});

export const reportIdSchema = z.object({
  params: z.object({ id: z.string().min(1), reportId: z.string().min(1) }),
});
