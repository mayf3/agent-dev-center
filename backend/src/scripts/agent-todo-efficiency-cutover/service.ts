/**
 * Core service module for Agent Todo Efficiency Cutover Tool.
 *
 * Implements:
 * - dry-run: validate everything, write nothing
 * - apply: CAS-based single-transaction update with AuditLog
 * - rollback: CAS-based single-transaction reversal from AuditLog
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import type {
  CliArgs,
  DatabaseIdentity,
  RequirementPreimage,
  RequirementPostimage,
  DryRunSummary,
  ApplySummary,
  RollbackSummary,
  CutoverAuditLogDetails,
  RollbackAuditLogDetails,
} from './types.js';
import { ErrorCodes } from './types.js';
import {
  resolveDatabaseUrl,
  parseDatabaseUrl,
  generateOperationId,
  queryDatabaseIdentity,
  validateDatabaseTarget,
  validateAgentTodoDomain,
  validateWorkflowTemplate,
  validateAgentTodoCount,
  validateUser,
  validateActor,
  validateUserCanAccessDomain,
  countAgentTodoRequirements,
} from './validators.js';
import {
  checkAllPreconditions,
  verifyPostcondition,
  verifyRollbackPrecondition,
} from './validation.js';
import {
  buildCutoverAuditLogDetails,
  buildRollbackAuditLogDetails,
} from './evidence.js';
// ─── Dry-run ──────────────────────────────────────────────────────────────
/**
 * Assert that the args have the required fields for dry-run/apply mode.
 */
function assertApplyArgs(args: CliArgs): asserts args is CliArgs & {
  requirementIds: [string, string, string];
  fromUserId: string;
  toUserId: string;
} {
  if (!args.requirementIds || !args.fromUserId || !args.toUserId) {
    throw new Error(`${ErrorCodes.INVALID_ARGS}: dry-run/apply 模式需要 --requirement-id, --from-user-id, --to-user-id`);
  }
}
export async function executeDryRun(
  prisma: PrismaClient,
  args: CliArgs,
): Promise<DryRunSummary> {
  assertApplyArgs(args);
  const operationId = generateOperationId();
  // 1. Database identity verification
  const { url } = resolveDatabaseUrl(args);
  const parsed = parseDatabaseUrl(url);
  const identity = await queryDatabaseIdentity(prisma, parsed);
  await validateDatabaseTarget(prisma, identity, {
    host: args.expectedHost,
    database: args.expectedDatabase,
    schema: args.expectedSchema,
  });
  // 2. Domain and workflow template validation
  await validateAgentTodoDomain(prisma);
  await validateWorkflowTemplate(prisma);
  // 3. Agent Todo count
  const countBefore = await validateAgentTodoCount(prisma, args.expectedAgentTodoCount);
  // 4. User validation
  const fromUser = await validateUser(prisma, args.fromUserId);
  const toUser = await validateUser(prisma, args.toUserId, undefined, args.expectedToUserEmail);
  // Validate to-user folder access to agent-todo
  await validateUserCanAccessDomain(prisma, toUser, 'agent-todo');
  // Validate expected from user name
  if (args.expectedFromUserName && fromUser.name !== args.expectedFromUserName) {
    throw new Error(`用户名不匹配: 期望 fromUserName="${args.expectedFromUserName}"，实际="${fromUser.name}"`);
  }
  // 5. Actor validation
  await validateActor(prisma, args.actorId, args.actorName);
  // 6. Instance precondition checks
  const preconditionSummary = await checkAllPreconditions(
    prisma,
    args.requirementIds,
    args.fromUserId,
    args.expectedFromUserName,
  );
  const requirements = preconditionSummary.results.map(r => ({
    id: r.id,
    title: r.state?.title ?? '(unknown)',
    stateVersionBefore: r.state?.stateVersion ?? -1,
    preconditionOk: r.ok,
  }));
  return {
    operationId,
    mode: 'dry-run',
    databaseIdentity: identity,
    fromUserId: args.fromUserId,
    toUserId: args.toUserId,
    actorId: args.actorId,
    actorName: args.actorName,
    expectedAgentTodoCount: args.expectedAgentTodoCount,
    agentTodoCountBefore: countBefore,
    requirements,
    plannedModifiedFields: [
      'workflowSnapshot.roleUserMap.efficiency-manager',
      'assigneeId',
      'assignee',
      'stateVersion (+1)',
    ],
    plannedAuditLogCount: 3,
  };
}
// ─── Apply ────────────────────────────────────────────────────────────────
export async function executeApply(
  prisma: PrismaClient,
  args: CliArgs,
  dryRunSummary?: DryRunSummary,
): Promise<ApplySummary> {
  assertApplyArgs(args);
  const operationId = dryRunSummary?.operationId ?? generateOperationId();
  // Shared pre-apply validations
  const { url } = resolveDatabaseUrl(args);
  const parsed = parseDatabaseUrl(url);
  const identity = await queryDatabaseIdentity(prisma, parsed);
  await validateDatabaseTarget(prisma, identity, {
    host: args.expectedHost,
    database: args.expectedDatabase,
    schema: args.expectedSchema,
  });
  await validateAgentTodoDomain(prisma);
  await validateWorkflowTemplate(prisma);
  const countBefore = await validateAgentTodoCount(prisma, args.expectedAgentTodoCount);
  // User validation
  const fromUser = await validateUser(prisma, args.fromUserId);
  const toUser = await validateUser(prisma, args.toUserId, undefined, args.expectedToUserEmail);
  // Validate to-user folder access to agent-todo
  await validateUserCanAccessDomain(prisma, toUser, 'agent-todo');
  // Validate expected from user name
  if (args.expectedFromUserName && fromUser.name !== args.expectedFromUserName) {
    throw new Error(`用户名不匹配: 期望 fromUserName="${args.expectedFromUserName}"，实际="${fromUser.name}"`);
  }
  // Actor validation
  const actor = await validateActor(prisma, args.actorId, args.actorName);
  // Precondition checks
  const preconditionSummary = await checkAllPreconditions(
    prisma,
    args.requirementIds,
    args.fromUserId,
    args.expectedFromUserName,
  );
  if (!preconditionSummary.passed) {
    throw new Error(`${ErrorCodes.INSTANCE_STATE_CHANGED}: 前置条件不满足，中止 Apply`);
  }
  // Collect preimages
  const preimages: RequirementPreimage[] = preconditionSummary.results.map(r => {
    const req = r.state!;
    const snapshot = req.workflowSnapshot as Record<string, unknown>;
    const roleUserMap = snapshot.roleUserMap as Record<string, string>;
    return {
      id: req.id,
      title: req.title,
      efficiencyManagerUserId: roleUserMap['efficiency-manager'],
      assigneeId: req.assigneeId,
      assignee: req.assignee,
      stateVersion: req.stateVersion,
      roleUserMap: { ...roleUserMap },
    };
  });
  // Execute in transaction
  const auditLogIds: string[] = [];
  let agentTodoCountInTransaction = 0;
  let agentTodoCountAfterWrite = 0;
  await prisma.$transaction(async (tx: any) => {
    // Count inside transaction before writes
    agentTodoCountInTransaction = await tx.requirement.count({
      where: { domainKey: 'agent-todo' },
    });
    if (agentTodoCountInTransaction !== args.expectedAgentTodoCount) {
      throw new Error(
        `${ErrorCodes.COUNT_MISMATCH}: 事务内 Agent Todo 计数不匹配。期望 ${args.expectedAgentTodoCount}，实际 ${agentTodoCountInTransaction}`
      );
    }
    const postimages: RequirementPostimage[] = [];
    for (const pre of preimages) {
      // Deep copy snapshot and modify only efficiency-manager
      const current = await tx.requirement.findUnique({
        where: { id: pre.id },
        select: { workflowSnapshot: true, stateVersion: true },
      });
      if (!current) {
        throw new Error(`事务内读取失败: ${pre.id}`);
      }
      // CAS: update with stateVersion match
      const expectedVersion = pre.stateVersion;
      const snapshotCopy = JSON.parse(JSON.stringify(current.workflowSnapshot)) as Record<string, unknown>;
      const roleUserMap = snapshotCopy.roleUserMap as Record<string, string>;
      roleUserMap['efficiency-manager'] = args.toUserId;
      snapshotCopy.roleUserMap = roleUserMap;
      const { count } = await tx.requirement.updateMany({
        where: {
          id: pre.id,
          stateVersion: expectedVersion,
        },
        data: {
          workflowSnapshot: snapshotCopy as any,
          assigneeId: args.toUserId,
          assignee: toUser.name,
          stateVersion: expectedVersion + 1,
        },
      });
      if (count !== 1) {
        throw new Error(
          `${ErrorCodes.CAS_CONFLICT}: Requirement ${pre.id} stateVersion=${expectedVersion} CAS 失败，count=${count}`
        );
      }
      const postimage: RequirementPostimage = {
        id: pre.id,
        efficiencyManagerUserId: args.toUserId,
        assigneeId: args.toUserId,
        assignee: toUser.name,
        stateVersion: expectedVersion + 1,
      };
      postimages.push(postimage);
      // Create AuditLog
      const details = buildCutoverAuditLogDetails(
        operationId,
        args.fromUserId,
        fromUser.name,
        args.toUserId,
        toUser.name,
        pre,
        postimage,
      );
      const auditLog = await tx.auditLog.create({
        data: {
          action: 'REQUIREMENT_ROLE_MIGRATED',
          targetType: 'requirement',
          targetId: pre.id,
          actorId: args.actorId,
          actorName: actor.name,
          details: details as any,
        },
      });
      auditLogIds.push(auditLog.id);
      // Immediate in-tx postcondition verification
      const postconditionResult = await verifyPostcondition(
        tx as unknown as PrismaClient,
        [pre.id],
        args.toUserId,
        toUser.name,
        args.fromUserId,
        1,
      );
      if (!postconditionResult.ok) {
        throw new Error(
          `${ErrorCodes.TRANSACTION_FAILED}: 写后验证失败: ${postconditionResult.reasons.join('; ')}`
        );
      }
    }
    // Count after writes inside transaction
    agentTodoCountAfterWrite = await tx.requirement.count({
      where: { domainKey: 'agent-todo' },
    });
    if (agentTodoCountAfterWrite !== args.expectedAgentTodoCount) {
      throw new Error(
        `${ErrorCodes.COUNT_MISMATCH}: 事务写入后 Agent Todo 计数变化。期望 ${args.expectedAgentTodoCount}，实际 ${agentTodoCountAfterWrite}`
      );
    }
  }, { timeout: 30000 });
  // Post-transaction read-only verification
  const finalPostcondition = await verifyPostcondition(
    prisma,
    args.requirementIds,
    args.toUserId,
    toUser.name,
    args.fromUserId,
    1,
  );
  const requirements = preimages.map((pre, i) => ({
    id: pre.id,
    title: pre.title,
    stateVersionBefore: pre.stateVersion,
    stateVersionAfter: pre.stateVersion + 1,
    ok: finalPostcondition.ok,
  }));
  return {
    operationId,
    mode: 'apply',
    agentTodoCountBefore: countBefore,
    agentTodoCountInTransaction,
    agentTodoCountAfterWrite,
    requirements,
    auditLogIds,
  };
}
// ─── Rollback ──────────────────────────────────────────────────────────────
export async function executeRollback(
  prisma: PrismaClient,
  args: CliArgs,
): Promise<RollbackSummary> {
  if (!args.operationId) {
    throw new Error(`${ErrorCodes.ROLLBACK_NOT_FOUND}: --rollback 需要 --operation-id`);
  }
  const operationId = generateOperationId();
  // Database target validation
  const { url } = resolveDatabaseUrl(args);
  const parsed = parseDatabaseUrl(url);
  const identity = await queryDatabaseIdentity(prisma, parsed);
  await validateDatabaseTarget(prisma, identity, {
    host: args.expectedHost,
    database: args.expectedDatabase,
    schema: args.expectedSchema,
  });
  await validateAgentTodoDomain(prisma);
  await validateWorkflowTemplate(prisma);
  await validateAgentTodoCount(prisma, args.expectedAgentTodoCount);
  // Actor validation
  const actor = await validateActor(prisma, args.actorId, args.actorName);
  // Read AuditLogs for this operationId
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      action: 'REQUIREMENT_ROLE_MIGRATED',
    },
    orderBy: { createdAt: 'desc' },
  });
  const matchedLogs = auditLogs.filter(
    (log: any) => (log.details as any)?.operationId === args.operationId
  );
  if (matchedLogs.length !== 3) {
    throw new Error(
      `${ErrorCodes.ROLLBACK_NOT_FOUND}: operationId ${args.operationId} 对应的 AuditLog 找到 ${matchedLogs.length} 条（期望 3）`
    );
  }
  const rollbackPrecondition = await verifyRollbackPrecondition(
    prisma,
    matchedLogs.map((l: any) => l.targetId),
  );
  if (!rollbackPrecondition.ok) {
    throw new Error(
      `${ErrorCodes.ROLLBACK_PRECONDITION}: ${rollbackPrecondition.reasons.join('; ')}`
    );
  }
  // Collect pre/post images from audit logs
  const rollbackEntries: Array<{
    requirementId: string;
    preimage: { efficiencyManagerUserId: string; assigneeId: string | null; assignee: string | null };
    postimage: { efficiencyManagerUserId: string; assigneeId: string; assignee: string; stateVersion: number };
  }> = [];
  for (const log of matchedLogs) {
    const details = (log.details as unknown) as CutoverAuditLogDetails;
    rollbackEntries.push({
      requirementId: log.targetId,
      preimage: details.preimage,
      postimage: details.postimage,
    });
  }
  // Execute rollback in transaction
  const rollbackAuditLogIds: string[] = [];
  const requirements: Array<{
    id: string;
    title: string;
    stateVersionBefore: number;
    stateVersionAfter: number;
    ok: boolean;
  }> = [];
  await prisma.$transaction(async (tx: any) => {
    for (const entry of rollbackEntries) {
      // Verify current state matches postimage
      const current = await tx.requirement.findUnique({
        where: { id: entry.requirementId },
        select: {
          id: true,
          title: true,
          assigneeId: true,
          assignee: true,
          currentStep: true,
          workflowSnapshot: true,
          stateVersion: true,
        },
      });
      if (!current) {
        throw new Error(`Rollback 目标缺失: ${entry.requirementId}`);
      }
      const snapshot = current.workflowSnapshot as Record<string, unknown>;
      const roleUserMap = snapshot.roleUserMap as Record<string, string>;
      const toId = entry.postimage.efficiencyManagerUserId.toLowerCase();
      const currentEff = (roleUserMap['efficiency-manager'] || '').toLowerCase();
      if (currentEff !== toId) {
        throw new Error(
          `${ErrorCodes.ROLLBACK_PRECONDITION}: ${entry.requirementId} efficiency-manager 不匹配 postimage。` +
          `期望 ${toId}，当前 ${currentEff}`
        );
      }
      if ((current.assigneeId || '').toLowerCase() !== toId) {
        throw new Error(
          `${ErrorCodes.ROLLBACK_PRECONDITION}: ${entry.requirementId} assigneeId 不匹配 postimage`
        );
      }
      if (current.stateVersion !== entry.postimage.stateVersion) {
        throw new Error(
          `${ErrorCodes.ROLLBACK_PRECONDITION}: ${entry.requirementId} stateVersion 不匹配。` +
          `期望 ${entry.postimage.stateVersion}，当前 ${current.stateVersion}`
        );
      }
      if (current.currentStep !== 'efficiency_review') {
        throw new Error(
          `${ErrorCodes.ROLLBACK_PRECONDITION}: ${entry.requirementId} 步骤已推进到 ${current.currentStep}`
        );
      }
      // CAS rollback: restore preimage values
      const snapshotCopy = JSON.parse(JSON.stringify(current.workflowSnapshot)) as Record<string, unknown>;
      const roleUserMapCopy = snapshotCopy.roleUserMap as Record<string, string>;
      roleUserMapCopy['efficiency-manager'] = entry.preimage.efficiencyManagerUserId;
      snapshotCopy.roleUserMap = roleUserMapCopy;
      const expectedVersion = current.stateVersion;
      const { count } = await tx.requirement.updateMany({
        where: {
          id: entry.requirementId,
          stateVersion: expectedVersion,
        },
        data: {
          workflowSnapshot: snapshotCopy as any,
          assigneeId: entry.preimage.assigneeId,
          assignee: entry.preimage.assignee,
          stateVersion: expectedVersion + 1,
        },
      });
      if (count !== 1) {
        throw new Error(
          `${ErrorCodes.CAS_CONFLICT}: Rollback CAS 失败: ${entry.requirementId}`
        );
      }
      // Write rollback AuditLog
      const rollbackDetails = buildRollbackAuditLogDetails(
        operationId,
        args.operationId!,
        operationId,
        {
          id: entry.requirementId,
          title: current.title,
          efficiencyManagerUserId: entry.preimage.efficiencyManagerUserId,
          assigneeId: entry.preimage.assigneeId,
          assignee: entry.preimage.assignee,
          stateVersion: expectedVersion,
          roleUserMap: roleUserMapCopy,
        },
        expectedVersion,
        expectedVersion + 1,
      );
      const auditLog = await tx.auditLog.create({
        data: {
          action: 'REQUIREMENT_ROLE_MIGRATION_ROLLED_BACK',
          targetType: 'requirement',
          targetId: entry.requirementId,
          actorId: args.actorId,
          actorName: actor.name,
          details: rollbackDetails as any,
        },
      });
      rollbackAuditLogIds.push(auditLog.id);
      requirements.push({
        id: current.id,
        title: current.title,
        stateVersionBefore: expectedVersion,
        stateVersionAfter: expectedVersion + 1,
        ok: true,
      });
    }
  }, { timeout: 30000 });
  return {
    operationId,
    originalOperationId: args.operationId,
    mode: 'rollback',
    requirements,
    auditLogIds: rollbackAuditLogIds,
  };
}
