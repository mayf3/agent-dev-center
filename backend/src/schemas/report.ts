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
  }),
});

export const reportIdSchema = z.object({
  params: z.object({ id: z.string().uuid(), reportId: z.string().uuid() }),
});
