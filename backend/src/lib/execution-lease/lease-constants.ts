import { Prisma } from '@prisma/client';
import { HttpError } from '../../utils/http-error.js';

export const LEASE_INCLUDE = {
  requirement: {
    select: {
      currentStep: true,
      stateVersion: true,
      assigneeId: true,
      repoPath: true,
    },
  },
  owner: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} as const;

export type LeaseWithDetails = Prisma.ExecutionLeaseGetPayload<{ include: typeof LEASE_INCLUDE }>;

export const EVENT_TYPE = {
  CLAIMED: 'CLAIMED',
  RENEWED: 'RENEWED',
  WORKTREE_BOUND: 'WORKTREE_BOUND',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
  ABANDONED: 'ABANDONED',
} as const;

export const TERMINAL_STEPS = new Set(['done', 'abandoned', 'cancelled', 'rejected']);

export const SYSTEM_KEY_PREFIX = 'system:';

export interface ClaimBody {
  idempotencyKey: string;
  expectedStep: string;
  expectedStateVersion: number;
  sessionId: string;
  ttlSeconds: number;
}

export interface RenewBody {
  idempotencyKey: string;
  sessionId: string;
  ttlSeconds: number;
}

export interface WorktreeBody {
  idempotencyKey: string;
  sessionId: string;
  worktreePath: string;
  gitBranch: string;
}

export interface ReleaseBody {
  idempotencyKey: string;
  sessionId: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'ABANDONED';
  reason?: string;
}

const GIT_BRANCH_REGEX = /^feat\/[A-Za-z0-9_-]+-[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;
export function validateGitBranch(branch: string, requirementId: string): void {
  const prefix = `feat/${requirementId}-`;
  if (!branch.startsWith(prefix)) {
    throw new HttpError(400, `gitBranch must start with feat/<requirementId>-<slug>, expected prefix: ${prefix}`);
  }
  const slug = branch.slice(prefix.length);
  if (!slug || slug.length === 0) {
    throw new HttpError(400, 'gitBranch must have a non-empty slug after requirementId');
  }
  if (!GIT_BRANCH_REGEX.test(branch)) {
    throw new HttpError(400, `gitBranch must match ^feat/<requirementId>-<slug>$ where slug is lowercase alphanumeric with internal hyphens/underscores, not starting/ending with separator`);
  }
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/');
}
