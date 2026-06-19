export const TRANSITION_EVENT_TYPE = {
  ADVANCED: 'ADVANCED',
  REJECTED: 'REJECTED',
  INVALIDATED: 'INVALIDATED',
} as const;

export const LEASE_TERMINAL_STATUS = {
  RELEASED: 'RELEASED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;

export const SYSTEM_KEY_PREFIX = 'system:';

export interface ExecutionProof {
  leaseId: string;
  sessionId: string;
  idempotencyKey: string;
  expectedStateVersion: number;
}

export interface ActorInfo {
  id: string;
  name: string;
  role: string;
  agentId: string | null | undefined;
}

export interface TransitionResult {
  requirementId: string;
  fromStep: string;
  toStep: string;
  toStepDisplayName?: string;
  newStateVersion: number;
  newAssigneeId: string | null;
  newAssigneeName: string | null;
  replayed: boolean;
  lockReleased: boolean;
  isDone: boolean;
}

export type LockAction =
  | { type: 'acquire'; title: string; branch: string | null }
  | { type: 'release' }
  | { type: 'none' };

export type TransitionSentinel =
  | { __expired: true; reason: string }
  | { __stale: true; reason: string };

export function isExpiredSentinel(v: unknown): v is { __expired: true; reason: string } {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>).__expired === true;
}

export function isStaleSentinel(v: unknown): v is { __stale: true; reason: string } {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>).__stale === true;
}

export function isTransitionSentinel(v: unknown): v is TransitionSentinel {
  return isExpiredSentinel(v) || isStaleSentinel(v);
}
