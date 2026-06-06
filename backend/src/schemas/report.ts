import { z } from 'zod';

export const reportTypeValues = [
  'DEV_SELF_CHECK',
  'SECURITY_REVIEW',
  'TEST_REPORT',
  'CTO_REVIEW',
  'TEST_DEPLOY_CONFIRM',
  'DEPLOY_CONFIRM',
  'POSTMORTEM',
] as const;

export const reportStatusValues = [
  'pending',
  'approved',
  'rejected',
  'changes_requested',
] as const;

export const submitReportSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reportType: z.enum(reportTypeValues),
    content: z.record(z.unknown()),
    submittedBy: z.string().min(1).optional(),
  }),
});

export const listReportsSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({
    reportType: z.enum(reportTypeValues).optional(),
    status: z.enum(reportStatusValues).optional(),
  }),
});

export const reviewReportSchema = z.object({
  params: z.object({ id: z.string().uuid(), reportId: z.string().uuid() }),
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
  params: z.object({ id: z.string().uuid(), reportId: z.string().uuid() }),
});
