/**
 * Types for Agent Todo Efficiency Manager Identity Cutover Tool
 */

/**
 * CLI operation mode.
 * Exactly one mode must be selected.
 */
export type OperationMode = 'dry-run' | 'apply' | 'rollback';

/**
 * Parsed and validated CLI arguments.
 * Optional fields depend on mode.
 */
export interface CliArgs {
  mode: OperationMode;

  // Requirement IDs — exactly 3, no duplicates (required for dry-run/apply)
  requirementIds?: [string, string, string];

  // Identity (required for dry-run/apply)
  fromUserId?: string;
  toUserId?: string;

  // Actor (required for all modes)
  actorId: string;
  actorName: string;

  // Database target validation (required for all modes)
  expectedHost: string;
  expectedDatabase: string;
  expectedSchema: string;
  expectedAgentTodoCount: number;

  // Optional env file path
  envFile?: string;

  // Rollback operation ID (required for rollback mode)
  operationId?: string;

  // Optional additional validations
  expectedToUserEmail?: string;
  expectedFromUserName?: string;
}

/**
 * Result of database identity validation.
 */
export interface DatabaseIdentity {
  currentDatabase: string;
  currentSchema: string;
  currentUser: string;
  inetServerAddr: string | null;
  inetServerPort: number | null;
  urlHost: string;
  urlDatabase: string;
  urlSchema: string;
}

/**
 * A single Requirement's state read from the database.
 */
export interface RequirementState {
  id: string;
  title: string;
  domainKey: string | null;
  currentStep: string | null;
  requesterId: string | null;
  assigneeId: string | null;
  assignee: string | null;
  workflowId: string | null;
  workflowSnapshot: unknown;
  stateVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Validation result for a single Requirement precondition.
 */
export interface RequirementPrecondition {
  id: string;
  ok: boolean;
  reasons: string[];
  state?: RequirementState;
  transitionCount?: number;
  reportCount?: number;
}

/**
 * Summary of all preconditions.
 */
export interface PreconditionSummary {
  passed: boolean;
  results: RequirementPrecondition[];
}

/**
 * Preimage of a Requirement before modification.
 */
export interface RequirementPreimage {
  id: string;
  title: string;
  efficiencyManagerUserId: string;
  assigneeId: string | null;
  assignee: string | null;
  stateVersion: number;
  roleUserMap: Record<string, string>;
}

/**
 * Postimage of a Requirement after modification.
 */
export interface RequirementPostimage {
  id: string;
  efficiencyManagerUserId: string;
  assigneeId: string;
  assignee: string;
  stateVersion: number;
}

/**
 * AuditLog details for the cutover operation.
 */
export interface CutoverAuditLogDetails {
  operationId: string;
  operation: 'switch_efficiency_manager' | 'rollback_efficiency_manager';
  workflowRole: 'efficiency-manager';
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  preimage: {
    efficiencyManagerUserId: string;
    assigneeId: string | null;
    assignee: string | null;
    stateVersion: number;
  };
  postimage: {
    efficiencyManagerUserId: string;
    assigneeId: string;
    assignee: string;
    stateVersion: number;
  };
}

/**
 * Rollback AuditLog details.
 */
export interface RollbackAuditLogDetails {
  operationId: string;
  originalOperationId: string;
  rollbackOperationId: string;
  operation: 'rollback_efficiency_manager';
  workflowRole: 'efficiency-manager';
  restoredPreimage: {
    efficiencyManagerUserId: string;
    assigneeId: string | null;
    assignee: string | null;
    stateVersionBefore: number;
    stateVersionAfter: number;
  };
}

/**
 * Dry-run output summary.
 */
export interface DryRunSummary {
  operationId: string;
  mode: 'dry-run';
  databaseIdentity: DatabaseIdentity;
  fromUserId: string;
  toUserId: string;
  actorId: string;
  actorName: string;
  expectedAgentTodoCount: number;
  agentTodoCountBefore: number;
  requirements: Array<{
    id: string;
    title: string;
    stateVersionBefore: number;
    preconditionOk: boolean;
  }>;
  plannedModifiedFields: string[];
  plannedAuditLogCount: number;
}

/**
 * Apply output summary.
 */
export interface ApplySummary {
  operationId: string;
  mode: 'apply';
  agentTodoCountBefore: number;
  agentTodoCountInTransaction: number;
  agentTodoCountAfterWrite: number;
  requirements: Array<{
    id: string;
    title: string;
    stateVersionBefore: number;
    stateVersionAfter: number;
    ok: boolean;
  }>;
  auditLogIds: string[];
}

/**
 * Rollback output summary.
 */
export interface RollbackSummary {
  operationId: string;
  originalOperationId: string;
  mode: 'rollback';
  requirements: Array<{
    id: string;
    title: string;
    stateVersionBefore: number;
    stateVersionAfter: number;
    ok: boolean;
  }>;
  auditLogIds: string[];
}

/**
 * Error codes for the tool.
 */
export const ErrorCodes = {
  MISSING_MODE: 'MISSING_MODE',
  INVALID_ARGS: 'INVALID_ARGS',
  UUID_FORMAT: 'UUID_FORMAT',
  DUPLICATE_ID: 'DUPLICATE_ID',
  WRONG_COUNT: 'WRONG_COUNT',
  FROM_EQ_TO: 'FROM_EQ_TO',
  ACTOR_DEFAULT: 'ACTOR_DEFAULT',
  MODE_CONFLICT: 'MODE_CONFLICT',
  DATABASE_TARGET_UNSAFE: 'BLOCKED_BY_DATABASE_TARGET_UNSAFE',
  DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  INVALID_ACTOR: 'BLOCKED_BY_INVALID_ACTOR',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_DISABLED: 'USER_DISABLED',
  INSTANCE_STATE_CHANGED: 'BLOCKED_BY_INSTANCE_STATE_CHANGED',
  CAS_CONFLICT: 'CAS_CONFLICT',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  ROLLBACK_NOT_FOUND: 'ROLLBACK_NOT_FOUND',
  ROLLBACK_PRECONDITION: 'BLOCKED_BY_ROLLBACK_PRECONDITION',
  ENV_CONFLICT: 'ENV_CONFLICT',
  WORKFLOW_ADVANCED: 'WORKFLOW_ADVANCED',
} as const;
