#!/usr/bin/env npx tsx
/**
 * cutover-agent-todo-efficiency-manager.ts
 *
 * Agent Todo 效率管家身份切换修正工具
 *
 * 一次性用途，切换完成后保留作为审计证据。
 *
 * 三种操作模式:
 *   --dry-run    前置检查，不写入数据库
 *   --apply      执行身份修正（CAS + 单事务）
 *   --rollback   回滚指定 operation 的身份修正
 *
 * 详细帮助: npx tsx backend/src/scripts/cutover-agent-todo-efficiency-manager.ts --help
 *
 * ⚠️ 安全约束:
 *   - 只修改白名单内 3 条指定 UUID 的 Requirement
 *   - 每条执行完整前置条件校验
 *   - 所有修改在一个 Prisma 事务中完成
 *   - 使用 CAS (stateVersion) 防止并发覆盖
 *   - 仅修改 workflowSnapshot.roleUserMap.efficiency-manager / assigneeId / assignee
 *   - 不修改 steps / currentStep / workflowId / lobster-partner / executor
 *   - 不创建 Transition / Report
 *   - 不修改 schema 或 migration
 *   - 不修改 User 表（Admin API 单独处理）
 *
 * 文档: docs/runbooks/agent-todo-efficiency-cutover.md
 */

import { runCli } from './agent-todo-efficiency-cutover/cli.js';

runCli(process.argv).then((result) => {
  console.log(result.output);
  process.exit(result.exitCode);
}).catch((err) => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});
