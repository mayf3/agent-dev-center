/**
 * Shared validators and utility helpers.
 * Kept under 500 lines by separating from heavier validation logic.
 */

import { PrismaClient } from '@prisma/client';
import { getPlatformRoles, isPlatformAdmin } from '../../lib/platform-roles.js';
import { ErrorCodes } from './types.js';
import type { CliArgs, DatabaseIdentity } from './types.js';

// ─── UUID v4 strict validation ────────────────────────────────────────────

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function isValidUuidV4(s: string): boolean {
  return UUID_V4_RE.test(s);
}

export function isNilUuid(s: string): boolean {
  return s.toLowerCase() === NIL_UUID;
}

// ─── Environment loading ──────────────────────────────────────────────────

/**
 * Resolve DATABASE_URL with env-file contract:
 * 1. If --env-file is provided, load from that file only
 * 2. If shell $DATABASE_URL exists, compare with env-file if both provided
 * 3. If neither, require $DATABASE_URL from current environment
 */
export function resolveDatabaseUrl(args: Pick<CliArgs, 'envFile'>): { url: string; source: string } {
  if (args.envFile) {
    const fs = require('node:fs');
    const envContent = fs.readFileSync(args.envFile, 'utf-8');
    const match = envContent.match(/^DATABASE_URL=(.+)$/m);
    if (!match) {
      throw new Error(`环境文件 ${args.envFile} 中未找到 DATABASE_URL`);
    }
    const fileUrl = match[1].trim();

    // Check shell environment for conflicts
    const shellUrl = process.env.DATABASE_URL;
    if (shellUrl && shellUrl !== fileUrl) {
      throw new Error(
        `${ErrorCodes.ENV_CONFLICT}: Shell 环境变量 DATABASE_URL 与 ${args.envFile} 中的值不一致。` +
        '请清除 shell 环境变量或使用 --env-file 指定的文件。'
      );
    }

    return { url: fileUrl, source: `env-file: ${args.envFile}` };
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL 未设置。请提供 --env-file 或确保环境变量 DATABASE_URL 已设置。');
  }

  return { url, source: 'shell environment DATABASE_URL' };
}

/**
 * Parse DATABASE_URL into components.
 */
export function parseDatabaseUrl(url: string): { host: string; port: number; database: string; user: string; schema: string } {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const port = parseInt(u.port || '5432', 10);
    const database = u.pathname.replace(/^\//, '');
    const user = u.username;
    const schema = u.searchParams.get('schema') || 'public';
    return { host, port, database, user, schema };
  } catch {
    throw new Error(`无法解析 DATABASE_URL: ${maskUrl(url)}`);
  }
}

/**
 * Mask sensitive parts of a database URL for safe logging.
 */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}:****@${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '<unparseable-url>';
  }
}

// ─── CLI argument extraction helpers ──────────────────────────────────────

export function extractArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const value = argv[idx + 1];
  if (value.startsWith('--')) return undefined;
  return value;
}

export function extractAllArgs(argv: string[], name: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) {
      result.push(argv[i + 1]);
      i++;
    }
  }
  return result;
}

/**
 * Generate a UUID v4 operation ID.
 */
export function generateOperationId(): string {
  const crypto = require('node:crypto');
  return crypto.randomUUID();
}

// ─── Database identity queries ────────────────────────────────────────────

/**
 * Query database identity from PostgreSQL.
 */
export async function queryDatabaseIdentity(
  prisma: PrismaClient,
  parsedUrl: { host: string; database: string; schema: string },
): Promise<DatabaseIdentity> {
  const result: Array<{
    current_database: string;
    current_schema: string;
    current_user: string;
    inet_server_addr: string | null;
    inet_server_port: number | null;
  }> = await prisma.$queryRawUnsafe(
    `SELECT current_database(), current_schema(), current_user, inet_server_addr(), inet_server_port();`
  ) as any;

  const row = result[0];

  return {
    currentDatabase: row.current_database,
    currentSchema: row.current_schema,
    currentUser: row.current_user,
    inetServerAddr: row.inet_server_addr,
    inetServerPort: row.inet_server_port,
    urlHost: parsedUrl.host,
    urlDatabase: parsedUrl.database,
    urlSchema: parsedUrl.schema,
  };
}

/**
 * Verify database identity matches expected values.
 */
export async function validateDatabaseTarget(
  prisma: PrismaClient,
  identity: DatabaseIdentity,
  expected: { host: string; database: string; schema: string },
): Promise<void> {
  const mismatches: string[] = [];

  if (identity.urlHost !== expected.host) {
    mismatches.push(`host: 期望 "${expected.host}"，URL 中为 "${identity.urlHost}"`);
  }
  if (identity.urlDatabase !== expected.database) {
    mismatches.push(`database: 期望 "${expected.database}"，URL 中为 "${identity.urlDatabase}"`);
  }
  if (identity.urlSchema !== expected.schema) {
    mismatches.push(`schema: 期望 "${expected.schema}"，URL 中为 "${identity.urlSchema}"`);
  }
  if (identity.currentDatabase !== expected.database) {
    mismatches.push(`current_database(): 期望 "${expected.database}"，返回 "${identity.currentDatabase}"`);
  }
  if (identity.currentSchema !== expected.schema) {
    mismatches.push(`current_schema(): 期望 "${expected.schema}"，返回 "${identity.currentSchema}"`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `${ErrorCodes.DATABASE_TARGET_UNSAFE}: 数据库目标验证失败:\n${mismatches.map(m => `  - ${m}`).join('\n')}`
    );
  }
}

// ─── Domain / Template validation ─────────────────────────────────────────

export async function validateAgentTodoDomain(prisma: PrismaClient): Promise<void> {
  const domain = await prisma.businessDomain.findUnique({
    where: { key: 'agent-todo' },
    select: { key: true, isActive: true },
  });
  if (!domain) throw new Error(`${ErrorCodes.DOMAIN_NOT_FOUND}: business_domains 中不存在 key=agent-todo`);
  if (!domain.isActive) throw new Error(`${ErrorCodes.DOMAIN_NOT_FOUND}: agent-todo Domain 非活跃状态`);
}

export async function validateWorkflowTemplate(prisma: PrismaClient): Promise<void> {
  const template = await prisma.workflowTemplate.findUnique({
    where: { name: 'agent-todo-v1' },
    select: { name: true, isActive: true },
  });
  if (!template) throw new Error(`${ErrorCodes.DOMAIN_NOT_FOUND}: workflow_templates 中不存在 name=agent-todo-v1`);
  if (!template.isActive) throw new Error(`${ErrorCodes.DOMAIN_NOT_FOUND}: agent-todo-v1 工作流模板非活跃`);
}

// ─── Agent Todo count ─────────────────────────────────────────────────────

export async function countAgentTodoRequirements(prisma: PrismaClient): Promise<number> {
  return prisma.requirement.count({ where: { domainKey: 'agent-todo' } });
}

export async function validateAgentTodoCount(prisma: PrismaClient, expected: number): Promise<number> {
  const actual = await countAgentTodoRequirements(prisma);
  if (actual !== expected) {
    throw new Error(`${ErrorCodes.COUNT_MISMATCH}: Agent Todo 需求总数不匹配。期望 ${expected}，实际 ${actual}`);
  }
  return actual;
}

// ─── User / Actor validation ──────────────────────────────────────────────

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  enabled: boolean;
  roles: string[];
  internalRole: string | null;
  role: string;
}

export async function validateUser(
  prisma: PrismaClient,
  userId: string,
  expectedName?: string,
  expectedEmail?: string,
): Promise<UserInfo> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, enabled: true, roles: true, internalRole: true, role: true },
  });

  if (!user) throw new Error(`${ErrorCodes.USER_NOT_FOUND}: 用户 ${userId} 不存在`);
  if (!user.enabled) throw new Error(`${ErrorCodes.USER_DISABLED}: 用户 ${userId} (${user.name}) 已禁用`);
  if (expectedName && user.name !== expectedName) throw new Error(`用户名不匹配: 期望 "${expectedName}"，实际 "${user.name}"`);
  if (expectedEmail && user.email !== expectedEmail) throw new Error(`用户邮箱不匹配: 期望 "${expectedEmail}"，实际 "${user.email}"`);

  return user;
}

export async function validateActor(
  prisma: PrismaClient,
  actorId: string,
  actorName: string,
): Promise<UserInfo> {
  const user = await validateUser(prisma, actorId);
  if (user.name !== actorName) {
    throw new Error(`${ErrorCodes.INVALID_ACTOR}: actor 名称不匹配: 期望 "${actorName}"，DB 中为 "${user.name}"`);
  }
  if (!isPlatformAdmin(user)) {
    const roles = getPlatformRoles(user);
    throw new Error(`${ErrorCodes.INVALID_ACTOR}: actor ${user.name} 不是 adc:admin。当前 roles: [${roles.join(', ')}]`);
  }
  return user;
}
