/**
 * Validation module for Agent Todo Efficiency Cutover Tool.
 *
 * Covers:
 * - CLI argument parsing and strict validation
 * - Database target identity verification
 * - Requirement instance precondition checks
 * - User / Actor validation
 * - Domain and workflow template validation
 * - Concurrency window detection (agent-todo count invariant)
 */

import { PrismaClient } from '@prisma/client';
import {
  isValidUuidV4,
  isNilUuid,
  extractArg,
  extractAllArgs,
  UserInfo,
} from './validators.js';
import type {
  CliArgs,
  OperationMode,
  RequirementPrecondition,
  PreconditionSummary,
} from './types.js';
import { ErrorCodes } from './types.js';

// ─── CLI argument parsing ─────────────────────────────────────────────────

export interface ParseResult {
  ok: boolean;
  args?: CliArgs;
  errors: string[];
}

/**
 * Parse raw process.argv into validated CliArgs.
 * Returns errors array — caller decides how to report.
 */
export function parseCliArgs(argv: string[]): ParseResult {
  const errors: string[] = [];

  // Determine mode
  const hasDryRun = argv.includes('--dry-run');
  const hasApply = argv.includes('--apply');
  const hasRollback = argv.includes('--rollback');
  const modes = [hasDryRun, hasApply, hasRollback].filter(Boolean).length;

  if (modes === 0) {
    errors.push(`${ErrorCodes.MISSING_MODE}: 必须指定操作模式: --dry-run, --apply 或 --rollback`);
    return { ok: false, errors };
  }

  if (modes > 1) {
    errors.push(`${ErrorCodes.MODE_CONFLICT}: --dry-run, --apply, --rollback 互斥，只能选一个`);
    return { ok: false, errors };
  }

  let mode: OperationMode;
  if (hasDryRun) mode = 'dry-run';
  else if (hasApply) mode = 'apply';
  else mode = 'rollback';

  if (mode === 'rollback') {
    return parseRollbackArgs(argv);
  }

  return parseApplyDryRunArgs(argv, mode);
}

function parseRollbackArgs(argv: string[]): ParseResult {
  const errors: string[] = [];
  const operationId = extractArg(argv, '--operation-id');

  if (!operationId) {
    errors.push(`${ErrorCodes.MISSING_MODE}: --rollback 需要 --operation-id <UUID>`);
    return { ok: false, errors };
  }

  if (!isValidUuidV4(operationId) || isNilUuid(operationId)) {
    errors.push(`${ErrorCodes.UUID_FORMAT}: --operation-id 不是有效的 UUID v4`);
    return { ok: false, errors };
  }

  const shared = parseSharedArgs(argv, errors);
  if (errors.length > 0) return { ok: false, errors };

  // Actor validation
  const actorId = extractArg(argv, '--actor-id');
  const actorName = extractArg(argv, '--actor-name');

  if (!actorId || !isValidUuidV4(actorId) || isNilUuid(actorId)) {
    errors.push(`${ErrorCodes.UUID_FORMAT}: --actor-id 需要有效的 UUID v4`);
  }
  if (!actorName) {
    errors.push(`${ErrorCodes.ACTOR_DEFAULT}: --actor-name 必填，不得默认`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    args: {
      ...shared,
      mode: 'rollback',
      operationId,
      actorId: actorId!,
      actorName: actorName!,
    } as CliArgs,
    errors: [],
  };
}

function parseApplyDryRunArgs(argv: string[], mode: OperationMode): ParseResult {
  const errors: string[] = [];

  // --requirement-id must be repeated exactly 3 times
  const reqIds = extractAllArgs(argv, '--requirement-id');
  if (reqIds.length !== 3) {
    errors.push(`${ErrorCodes.WRONG_COUNT}: 需要恰好 3 个 --requirement-id，收到 ${reqIds.length}`);
    return { ok: false, errors };
  }

  // Validate each UUID
  for (const id of reqIds) {
    if (!isValidUuidV4(id)) {
      errors.push(`${ErrorCodes.UUID_FORMAT}: "${id}" 不是有效的 UUID v4`);
    }
    if (isNilUuid(id)) {
      errors.push(`${ErrorCodes.UUID_FORMAT}: nil UUID (${id}) 不允许`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Check no duplicates
  if (new Set(reqIds).size !== 3) {
    errors.push(`${ErrorCodes.DUPLICATE_ID}: 三个 --requirement-id 必须互不相同`);
    return { ok: false, errors };
  }

  const fromUserId = extractArg(argv, '--from-user-id');
  const toUserId = extractArg(argv, '--to-user-id');

  if (!fromUserId || !isValidUuidV4(fromUserId) || isNilUuid(fromUserId)) {
    errors.push(`${ErrorCodes.UUID_FORMAT}: --from-user-id 需要有效的 UUID v4`);
  }
  if (!toUserId || !isValidUuidV4(toUserId) || isNilUuid(toUserId)) {
    errors.push(`${ErrorCodes.UUID_FORMAT}: --to-user-id 需要有效的 UUID v4`);
  }

  if (fromUserId && toUserId && fromUserId.toLowerCase() === toUserId.toLowerCase()) {
    errors.push(`${ErrorCodes.FROM_EQ_TO}: --from-user-id 不能等于 --to-user-id`);
  }

  const actorId = extractArg(argv, '--actor-id');
  const actorName = extractArg(argv, '--actor-name');

  if (!actorId || !isValidUuidV4(actorId) || isNilUuid(actorId)) {
    errors.push(`${ErrorCodes.UUID_FORMAT}: --actor-id 需要有效的 UUID v4`);
  }
  if (!actorName) {
    errors.push(`${ErrorCodes.ACTOR_DEFAULT}: --actor-name 必填，不得默认`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const shared = parseSharedArgs(argv, errors);
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    args: {
      ...shared,
      mode,
      requirementIds: reqIds as [string, string, string],
      fromUserId: fromUserId!,
      toUserId: toUserId!,
      actorId: actorId!,
      actorName: actorName!,
    },
    errors: [],
  };
}

function parseSharedArgs(argv: string[], errors: string[]): Omit<CliArgs, 'mode' | 'requirementIds' | 'fromUserId' | 'toUserId' | 'actorId' | 'actorName' | 'operationId'> {
  const expectedHost = extractArg(argv, '--expected-host');
  const expectedDatabase = extractArg(argv, '--expected-database');
  const expectedSchema = extractArg(argv, '--expected-schema');
  const expectedAgentTodoCountStr = extractArg(argv, '--expected-agent-todo-count');
  const envFile = extractArg(argv, '--env-file');
  const expectedToUserEmail = extractArg(argv, '--expected-to-user-email');
  const expectedFromUserName = extractArg(argv, '--expected-from-user-name');

  if (!expectedHost) errors.push('--expected-host 必填');
  if (!expectedDatabase) errors.push('--expected-database 必填');
  if (!expectedSchema) errors.push('--expected-schema 必填');

  let expectedAgentTodoCount = 0;
  if (!expectedAgentTodoCountStr) {
    errors.push('--expected-agent-todo-count 必填');
  } else {
    expectedAgentTodoCount = parseInt(expectedAgentTodoCountStr, 10);
    if (isNaN(expectedAgentTodoCount) || expectedAgentTodoCount < 0) {
      errors.push('--expected-agent-todo-count 必须是非负整数');
    }
  }

  return {
    expectedHost: expectedHost || '',
    expectedDatabase: expectedDatabase || '',
    expectedSchema: expectedSchema || '',
    expectedAgentTodoCount,
    envFile,
    expectedToUserEmail,
    expectedFromUserName,
  };
}

// ─── Instance precondition checks ─────────────────────────────────────────

export async function checkRequirementPrecondition(
  prisma: PrismaClient,
  requirementId: string,
  fromUserId: string,
  expectedFromUserName?: string,
): Promise<RequirementPrecondition> {
  const result: RequirementPrecondition = {
    id: requirementId,
    ok: true,
    reasons: [],
  };

  const req = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: {
      id: true,
      title: true,
      domainKey: true,
      currentStep: true,
      requesterId: true,
      assigneeId: true,
      assignee: true,
      workflowId: true,
      workflowSnapshot: true,
      stateVersion: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!req) {
    result.ok = false;
    result.reasons.push('NOT_FOUND: Requirement 不存在');
    return result;
  }

  result.state = req;
  const fromId = fromUserId.toLowerCase();

  if (req.domainKey !== 'agent-todo') {
    result.ok = false;
    result.reasons.push(`DOMAIN_MISMATCH: 期望 agent-todo，实际 ${req.domainKey}`);
  }

  if (req.currentStep !== 'efficiency_review') {
    result.ok = false;
    result.reasons.push(`STEP_MISMATCH: 期望 efficiency_review，实际 ${req.currentStep}`);
  }

  if (!req.assigneeId || req.assigneeId.toLowerCase() !== fromId) {
    result.ok = false;
    result.reasons.push(`ASSIGNEE_ID_MISMATCH: 期望 ${fromUserId}，实际 ${req.assigneeId}`);
  }

  if (expectedFromUserName !== undefined && req.assignee !== expectedFromUserName) {
    result.ok = false;
    result.reasons.push(`ASSIGNEE_NAME_MISMATCH: 期望 "${expectedFromUserName}"，实际 "${req.assignee}"`);
  }

  // roleUserMap checks
  const snapshot = req.workflowSnapshot as Record<string, unknown> | null;
  if (!snapshot || typeof snapshot !== 'object') {
    result.ok = false;
    result.reasons.push('WORKFLOW_SNAPSHOT_MISSING');
  } else {
    const roleUserMap = snapshot.roleUserMap as Record<string, string> | undefined;
    if (!roleUserMap || typeof roleUserMap !== 'object') {
      result.ok = false;
      result.reasons.push('ROLE_USER_MAP_MISSING');
    } else {
      const eff = roleUserMap['efficiency-manager'];
      const lob = roleUserMap['lobster-partner'];
      const exec = roleUserMap.executor;

      if (!eff || eff.toLowerCase() !== fromId) {
        result.ok = false;
        result.reasons.push(`ROLE_MAP_EFFICIENCY_MISMATCH: 期望 efficiency-manager=${fromUserId}，实际=${eff}`);
      }
      if (!lob || lob.toLowerCase() !== fromId) {
        result.ok = false;
        result.reasons.push(`ROLE_MAP_LOBSTER_MISMATCH: 期望 lobster-partner=${fromUserId}，实际=${lob}`);
      }
      if (!exec || exec.toLowerCase() !== fromId) {
        result.ok = false;
        result.reasons.push(`ROLE_MAP_EXECUTOR_MISMATCH: 期望 executor=${fromUserId}，实际=${exec}`);
      }
    }
  }

  const [transitionCount, reportCount] = await Promise.all([
    prisma.workflowTransition.count({ where: { requirementId } }),
    prisma.requirementReport.count({ where: { requirementId } }),
  ]);

  result.transitionCount = transitionCount;
  result.reportCount = reportCount;

  if (transitionCount !== 0) {
    result.ok = false;
    result.reasons.push(`TRANSITION_COUNT_MISMATCH: 期望 0，实际 ${transitionCount}`);
  }
  if (reportCount !== 0) {
    result.ok = false;
    result.reasons.push(`REPORT_COUNT_MISMATCH: 期望 0，实际 ${reportCount}`);
  }

  return result;
}

export async function checkAllPreconditions(
  prisma: PrismaClient,
  requirementIds: string[],
  fromUserId: string,
  expectedFromUserName?: string,
): Promise<PreconditionSummary> {
  const results: RequirementPrecondition[] = [];
  for (const id of requirementIds) {
    const r = await checkRequirementPrecondition(prisma, id, fromUserId, expectedFromUserName);
    results.push(r);
  }

  const allOk = results.every(r => r.ok);
  return { passed: allOk, results };
}

/**
 * Verify postcondition after apply — uses a NEW independent check
 * (not a reuse of the precondition function with inverted logic).
 */
export async function verifyPostcondition(
  prisma: PrismaClient,
  requirementIds: string[],
  toUserId: string,
  toUserName: string,
  fromUserId: string,
  expectedStateVersionIncrement: number,
): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  for (const id of requirementIds) {
    const req = await prisma.requirement.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        currentStep: true,
        requesterId: true,
        assigneeId: true,
        assignee: true,
        workflowId: true,
        workflowSnapshot: true,
        stateVersion: true,
      },
    });

    if (!req) {
      reasons.push(`REQUIREMENT_MISSING: ${id}`);
      continue;
    }

    const toId = toUserId.toLowerCase();
    const fromId = fromUserId.toLowerCase();
    const snapshot = req.workflowSnapshot as Record<string, unknown> | null;
    const roleUserMap = snapshot?.roleUserMap as Record<string, string> | undefined;

    // Positive checks (what SHOULD have changed)
    if (!req.assigneeId || req.assigneeId.toLowerCase() !== toId) {
      reasons.push(`[${id}] assigneeId 应为 ${toUserId}，实际 ${req.assigneeId}`);
    }
    if (req.assignee !== toUserName) {
      reasons.push(`[${id}] assignee 应为 "${toUserName}"，实际 "${req.assignee}"`);
    }
    if (!roleUserMap || !roleUserMap['efficiency-manager'] || roleUserMap['efficiency-manager'].toLowerCase() !== toId) {
      reasons.push(`[${id}] efficiency-manager 应为 ${toUserId}，实际 ${roleUserMap?.['efficiency-manager']}`);
    }

    // Negative checks (what must NOT have changed)
    if (req.currentStep !== 'efficiency_review') {
      reasons.push(`[${id}] currentStep 不应变化: 仍为 ${req.currentStep}`);
    }
    if (roleUserMap) {
      const lob = roleUserMap['lobster-partner'];
      const exec = roleUserMap.executor;
      if (!lob || lob.toLowerCase() !== fromId) {
        reasons.push(`[${id}] lobster-partner 不应变化: 期望 ${fromUserId}，实际 ${lob}`);
      }
      if (!exec || exec.toLowerCase() !== fromId) {
        reasons.push(`[${id}] executor 不应变化: 期望 ${fromUserId}，实际 ${exec}`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Rollback precondition verification.
 */
export async function verifyRollbackPrecondition(
  prisma: PrismaClient,
  requirementIds: string[],
): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  for (const id of requirementIds) {
    const [transitionCount, reportCount] = await Promise.all([
      prisma.workflowTransition.count({ where: { requirementId: id } }),
      prisma.requirementReport.count({ where: { requirementId: id } }),
    ]);

    if (transitionCount !== 0) {
      reasons.push(`[${id}] rollback 拒绝: 已有 ${transitionCount} 条 Transition`);
    }
    if (reportCount !== 0) {
      reasons.push(`[${id}] rollback 拒绝: 已有 ${reportCount} 条 Report`);
    }

    // Verify currentStep hasn't advanced
    const req = await prisma.requirement.findUnique({
      where: { id },
      select: { currentStep: true },
    });
    if (req && req.currentStep !== 'efficiency_review') {
      reasons.push(`[${id}] rollback 拒绝: 步骤已从 efficiency_review 推进到 ${req.currentStep}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}