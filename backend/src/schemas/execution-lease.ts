import { z } from 'zod';

const idempotencyKeySchema = z.string().trim().min(1).max(255)
  .refine((k) => !k.startsWith('system:'), { message: 'idempotencyKey cannot start with system:' });

const sessionIdSchema = z.string().trim().min(1).max(255);

export const claimLeaseSchema = z.object({
  body: z.object({
    idempotencyKey: idempotencyKeySchema,
    expectedStep: z.string().trim().min(1).max(80),
    expectedStateVersion: z.number().int().nonnegative(),
    sessionId: sessionIdSchema,
    ttlSeconds: z.number().int().min(300).max(14400).default(3600),
  }),
});

export const renewLeaseSchema = z.object({
  body: z.object({
    idempotencyKey: idempotencyKeySchema,
    sessionId: sessionIdSchema,
    ttlSeconds: z.number().int().min(300).max(14400).default(3600),
  }),
});

const gitBranchSlugRegex = /^feat\/[A-Za-z0-9_-]+-[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;

export const updateWorktreeSchema = z.object({
  body: z.object({
    idempotencyKey: idempotencyKeySchema,
    sessionId: sessionIdSchema,
    worktreePath: z.string().trim().min(1).refine((p) => p.startsWith('/'), {
      message: 'worktreePath must be an absolute path starting with /',
    }),
    gitBranch: z.string().trim().min(1).regex(gitBranchSlugRegex, {
      message: 'gitBranch must match feat/<requirementId>-<slug> where slug is lowercase alphanumeric with internal hyphens/underscores',
    }),
  }),
});

export const releaseLeaseSchema = z.object({
  body: z.object({
    idempotencyKey: idempotencyKeySchema,
    sessionId: sessionIdSchema,
    outcome: z.enum(['SUCCEEDED', 'FAILED', 'ABANDONED']),
    reason: z.string().trim().max(500).optional(),
  }),
});

export const leaseIdParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    leaseId: z.string().uuid(),
  }),
});
