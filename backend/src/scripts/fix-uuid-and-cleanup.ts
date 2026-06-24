/**
 * fix-uuid-and-cleanup.ts
 *
 * 修复 users 表中损坏的 UUID 字段，并清理 admin@example.com 账号。
 *
 * 问题1: 某些记录的 UUID 字段存了非 UUID 数据（如 email 字符串），导致 Prisma P2023
 * 问题2: admin@example.com 账号密码损坏，CTO 确认删除
 *
 * 运行方式: npx tsx src/scripts/fix-uuid-and-cleanup.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 合法 UUID v4 正则
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  console.log('🔧 Fixing UUID fields and cleaning up admin@example.com...\n');

  // 用 raw query 避免被 Prisma 的 UUID 校验拦截
  const users = await prisma.$queryRaw<Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    internal_role: string | null;
    manager_id: string | null;
  }>>`SELECT id, email, name, role, internal_role, manager_id FROM users ORDER BY created_at`;

  console.log(`Found ${users.length} users\n`);

  let uuidFixed = 0;
  let orphanRefs = 0;
  const badUsers: string[] = [];

  // 1. 检查所有 UUID 字段
  for (const user of users) {
    const issues: string[] = [];

    if (!UUID_REGEX.test(user.id)) {
      issues.push(`id="${user.id}" is not a valid UUID`);
      badUsers.push(user.email);
    }
    if (user.manager_id && !UUID_REGEX.test(user.manager_id)) {
      issues.push(`manager_id="${user.manager_id}" is not a valid UUID`);
      // 清理无效的 manager_id
      await prisma.$executeRaw`UPDATE users SET manager_id = NULL WHERE id = ${user.id}`;
      orphanRefs++;
      console.log(`  🧹 Cleaned invalid manager_id for ${user.email}`);
    }

    if (issues.length > 0) {
      console.log(`  ⚠️  ${user.email}: ${issues.join(', ')}`);
      uuidFixed++;
    }
  }

  if (badUsers.length > 0) {
    console.log(`\n❌ ${badUsers.length} users have corrupted UUID id — needs manual fix:`);
    for (const email of badUsers) {
      console.log(`  - ${email}`);
    }
    // 对 UUID 损坏的记录：生成新 UUID 替换（保留原 email/name）
    for (const user of users) {
      if (!UUID_REGEX.test(user.id)) {
        const crypto = await import('node:crypto');
        const newId = crypto.randomUUID();
        console.log(`  🔨 Reassigning ${user.email}: ${user.id} → ${newId}`);
        // 先更新所有引用此用户的外键
        await prisma.$executeRaw`UPDATE requirements SET assignee_id = ${newId} WHERE assignee_id = ${user.id}`;
        await prisma.$executeRaw`UPDATE requirements SET requester_id = ${newId} WHERE requester_id = ${user.id}`;
        await prisma.$executeRaw`UPDATE requirements SET last_modified_by = ${newId} WHERE last_modified_by = ${user.id}`;
        await prisma.$executeRaw`UPDATE audit_logs SET actor_id = ${newId} WHERE actor_id = ${user.id}`;
        await prisma.$executeRaw`UPDATE reports SET author_id = ${newId} WHERE author_id = ${user.id}`;
        await prisma.$executeRaw`UPDATE users SET manager_id = ${newId} WHERE manager_id = ${user.id}`;
        // 最后更新用户 id
        await prisma.$executeRaw`UPDATE users SET id = ${newId} WHERE id = ${user.id}`;
        uuidFixed++;
      }
    }
  }

  // 2. 删除 admin@example.com
  console.log('\n--- Cleaning up admin@example.com ---');
  const adminUser = users.find(u => u.email === 'admin@example.com');
  if (adminUser) {
    // 先删除关联数据
    await prisma.$executeRaw`DELETE FROM audit_logs WHERE actor_id = ${adminUser.id}`;
    await prisma.$executeRaw`DELETE FROM reports WHERE author_id = ${adminUser.id}`;
    await prisma.$executeRaw`DELETE FROM marketplace_agents WHERE owner_id = ${adminUser.id}`;
    // 删除用户
    await prisma.$executeRaw`DELETE FROM users WHERE email = 'admin@example.com'`;
    console.log(`  🗑️  Deleted admin@example.com (id: ${adminUser.id})`);
  } else {
    console.log('  ℹ️  admin@example.com not found (already cleaned)');
  }

  // 3. 验证
  console.log('\n--- Verification ---');
  const remaining = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) as count FROM users`;
  console.log(`  Total users: ${remaining[0].count}`);

  const badIds = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT email FROM users WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text
  `;
  console.log(`  Bad UUIDs remaining: ${badIds.length}`);

  console.log(`\n📊 Summary: ${uuidFixed} UUID fixes, ${orphanRefs} orphan refs cleaned`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Fix failed:', e);
  process.exit(1);
});
