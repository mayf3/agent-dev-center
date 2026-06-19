import { prisma } from '../prisma.js';
import { claimExecutionLease as claimFn } from './lease-claim.js';
import { renewExecutionLease as renewFn } from './lease-renew.js';
import { updateLeaseWorktree as worktreeFn } from './lease-worktree.js';
import { releaseExecutionLease as releaseFn } from './lease-release.js';
import { getExecutionLease as getFn } from './lease-get.js';
import type { ClaimBody, RenewBody, WorktreeBody, ReleaseBody } from './lease-constants.js';

export const claimExecutionLease = (requirementId: string, ownerUserId: string, ownerAgentId: string | null | undefined, body: ClaimBody) =>
  claimFn(prisma as any, requirementId, ownerUserId, ownerAgentId ?? null, body);

export const renewExecutionLease = (requirementId: string, leaseId: string, ownerUserId: string, ownerAgentId: string | null | undefined, body: RenewBody) =>
  renewFn(prisma as any, requirementId, leaseId, ownerUserId, ownerAgentId ?? null, body);

export const updateLeaseWorktree = (requirementId: string, leaseId: string, ownerUserId: string, ownerAgentId: string | null | undefined, body: WorktreeBody) =>
  worktreeFn(prisma as any, requirementId, leaseId, ownerUserId, ownerAgentId ?? null, body);

export const releaseExecutionLease = (requirementId: string, leaseId: string, ownerUserId: string, ownerAgentId: string | null | undefined, body: ReleaseBody) =>
  releaseFn(prisma as any, requirementId, leaseId, ownerUserId, ownerAgentId ?? null, body);

export const getExecutionLease = (requirementId: string) =>
  getFn(prisma as any, requirementId);

export type { ClaimResult } from './lease-claim.js';
export type { RenewResult } from './lease-renew.js';
export type { LeaseQueryResult } from './lease-get.js';
export type { LeaseWithDetails } from './lease-constants.js';
