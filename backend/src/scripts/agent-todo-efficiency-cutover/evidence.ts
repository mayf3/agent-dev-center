/**
 * Evidence module for Agent Todo Efficiency Cutover Tool.
 *
 * Builds AuditLog detail payloads and output summaries.
 * Never contains or logs passwords, JWTs, or full connection URLs.
 */

import type {
  CutoverAuditLogDetails,
  RollbackAuditLogDetails,
  RequirementPreimage,
  RequirementPostimage,
  DryRunSummary,
  ApplySummary,
  RollbackSummary,
  DatabaseIdentity,
} from './types.js';

// ─── AuditLog detail builders ─────────────────────────────────────────────

export function buildCutoverAuditLogDetails(
  operationId: string,
  fromUserId: string,
  fromUserName: string,
  toUserId: string,
  toUserName: string,
  preimage: RequirementPreimage,
  postimage: RequirementPostimage,
): CutoverAuditLogDetails {
  return {
    operationId,
    operation: 'switch_efficiency_manager',
    workflowRole: 'efficiency-manager',
    fromUserId,
    fromUserName,
    toUserId,
    toUserName,
    preimage: {
      efficiencyManagerUserId: preimage.efficiencyManagerUserId,
      assigneeId: preimage.assigneeId,
      assignee: preimage.assignee,
      stateVersion: preimage.stateVersion,
    },
    postimage: {
      efficiencyManagerUserId: postimage.efficiencyManagerUserId,
      assigneeId: postimage.assigneeId,
      assignee: postimage.assignee,
      stateVersion: postimage.stateVersion,
    },
  };
}

export function buildRollbackAuditLogDetails(
  operationId: string,
  originalOperationId: string,
  rollbackOperationId: string,
  preimage: RequirementPreimage,
  stateVersionBefore: number,
  stateVersionAfter: number,
): RollbackAuditLogDetails {
  return {
    operationId: rollbackOperationId,
    originalOperationId,
    rollbackOperationId,
    operation: 'rollback_efficiency_manager',
    workflowRole: 'efficiency-manager',
    restoredPreimage: {
      efficiencyManagerUserId: preimage.efficiencyManagerUserId,
      assigneeId: preimage.assigneeId,
      assignee: preimage.assignee,
      stateVersionBefore,
      stateVersionAfter,
    },
  };
}

// ─── Output formatters ─────────────────────────────────────────────────────

export function formatDryRunOutput(summary: DryRunSummary): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║   Agent Todo 效率管家身份切换 — Dry-run                      ║',
    '╚══════════════════════════════════════════════════════════════╝',
    '',
    `operationId:            ${summary.operationId}`,
    `mode:                   ${summary.mode}`,
    '',
    '── Database Identity ──',
    formatDatabaseIdentitySafe(summary.databaseIdentity),
    '',
    `expected Agent Todo count: ${summary.expectedAgentTodoCount}`,
    `actual Agent Todo count:   ${summary.agentTodoCountBefore}`,
    '',
    `fromUserId:             ${maskUuid(summary.fromUserId)}`,
    `toUserId:               ${maskUuid(summary.toUserId)}`,
    `actorId:                ${maskUuid(summary.actorId)}`,
    `actorName:              ${summary.actorName}`,
    '',
    '── Requirements ──',
    ...summary.requirements.map((r, i) =>
      `  ${i + 1}. [${maskUuid(r.id)}] "${r.title}" — stateVersion=${r.stateVersionBefore} — 前置条件: ${r.preconditionOk ? '✅' : '❌'}`
    ),
    '',
    '── Planned Changes ──',
    `  修改字段: ${summary.plannedModifiedFields.join(', ')}`,
    `  AuditLog 数量: ${summary.plannedAuditLogCount}`,
    '',
    'ℹ️  Dry-run 完成，未写入任何数据。',
  ];

  return lines.join('\n');
}

export function formatApplyOutput(summary: ApplySummary): string {
  const allOk = summary.requirements.every(r => r.ok);

  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║   Agent Todo 效率管家身份切换 — Apply                         ║',
    '╚══════════════════════════════════════════════════════════════╝',
    '',
    `operationId:            ${summary.operationId}`,
    `mode:                   ${summary.mode}`,
    '',
    `Agent Todo count (before / in-tx / after): ${summary.agentTodoCountBefore} / ${summary.agentTodoCountInTransaction} / ${summary.agentTodoCountAfterWrite}`,
    '',
    '── Requirements ──',
    ...summary.requirements.map((r, i) =>
      `  ${i + 1}. [${maskUuid(r.id)}] "${r.title}" — stateVersion: ${r.stateVersionBefore} → ${r.stateVersionAfter} — ${r.ok ? '✅' : '❌'}`
    ),
    '',
    `AuditLog IDs: ${summary.auditLogIds.map(id => maskUuid(id)).join(', ')}`,
    '',
    allOk
      ? '✅ 全部修正完成。请记录 operationId 并在 Runbook 中继续验证。'
      : '❌ 部分修正失败，请检查日志。',
  ];

  return lines.join('\n');
}

export function formatRollbackOutput(summary: RollbackSummary): string {
  const allOk = summary.requirements.every(r => r.ok);

  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║   Agent Todo 效率管家身份切换 — Rollback                      ║',
    '╚══════════════════════════════════════════════════════════════╝',
    '',
    `operationId:              ${summary.operationId}`,
    `originalOperationId:      ${summary.originalOperationId}`,
    `mode:                     ${summary.mode}`,
    '',
    '── Requirements ──',
    ...summary.requirements.map((r, i) =>
      `  ${i + 1}. [${maskUuid(r.id)}] "${r.title}" — stateVersion: ${r.stateVersionBefore} → ${r.stateVersionAfter} — ${r.ok ? '✅' : '❌'}`
    ),
    '',
    `AuditLog IDs: ${summary.auditLogIds.map(id => maskUuid(id)).join(', ')}`,
    '',
    allOk
      ? '✅ Rollback 完成。请验证数据一致性。'
      : '❌ Rollback 失败。',
  ];

  return lines.join('\n');
}

export function formatHelp(): string {
  return [
    'Agent Todo 效率管家身份切换工具',
    '',
    'Usage:',
    '  npx tsx backend/src/scripts/cutover-agent-todo-efficiency-manager.ts <mode> [options]',
    '',
    'Modes (exactly one):',
    '  --dry-run                     前置检查，不写入数据库',
    '  --apply                       执行身份修正',
    '  --rollback                    回滚指定 operation 的修正',
    '',
    'Common options:',
    '  --requirement-id <UUID>       目标 Requirement UUID（重复恰好3次，仅 dry-run/apply）',
    '  --from-user-id <UUID>         当前效率管家 User UUID（仅 dry-run/apply）',
    '  --to-user-id <UUID>           新效率管家 User UUID（仅 dry-run/apply）',
    '  --actor-id <UUID>             执行管理员 User UUID',
    '  --actor-name <NAME>           执行管理员名称',
    '  --expected-host <HOST>        期望数据库 host',
    '  --expected-database <DB>      期望数据库名称',
    '  --expected-schema <SCHEMA>    期望 schema',
    '  --expected-agent-todo-count <N> 期望 Agent Todo 需求总数',
    '  --env-file <PATH>             数据库配置环境文件（可选）',
    '  --expected-to-user-email <E>  新效率管家邮箱（可选校验）',
    '  --expected-from-user-name <N> 旧效率管家名称（可选校验）',
    '',
    'Rollback options:',
    '  --operation-id <UUID>         要回滚的 operationId',
    '',
    'Examples:',
    '  # Dry-run',
    '  npx tsx ... --dry-run --requirement-id <id1> --requirement-id <id2> --requirement-id <id3> \\',
    '    --from-user-id <uuid> --to-user-id <uuid> --actor-id <uuid> --actor-name "Admin" \\',
    '    --expected-host postgres-authoritative --expected-database agent_dev_center \\',
    '    --expected-schema public --expected-agent-todo-count 3',
    '',
    '  # Apply',
    '  npx tsx ... --apply [same options]',
    '',
    '  # Rollback',
    '  npx tsx ... --rollback --operation-id <uuid> \\',
    '    --actor-id <uuid> --actor-name "Admin" \\',
    '    --expected-host postgres-authoritative --expected-database agent_dev_center \\',
    '    --expected-schema public --expected-agent-todo-count 3',
  ].join('\n');
}

function maskUuid(uuid: string): string {
  if (!uuid || uuid.length < 8) return uuid;
  return uuid.slice(0, 8) + '...';
}

function formatDatabaseIdentitySafe(identity: DatabaseIdentity): string {
  return [
    `host:         ${identity.urlHost}`,
    `port:         ${identity.inetServerPort ?? '?'}`,
    `database:     ${identity.urlDatabase}`,
    `schema:       ${identity.urlSchema}`,
    `current_database: ${identity.currentDatabase}`,
    `current_schema:   ${identity.currentSchema}`,
    `current_user:     ${identity.currentUser}`,
    `inet_server:      ${identity.inetServerAddr ?? '?'}`,
  ].join('\n');
}
