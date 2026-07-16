/**
 * 清理历史悬空数据：把 UUID 格式的 assignee 修正为对应用户名
 * 
 * 问题：assignee 字段当前是自由文本，没有校验是否是有效用户
 * 导致 12 个任务分配给了 UUID 格式的 assignee 而悬空
 * 
 * 修复方案：
 * 1. 找出所有 assignee 为 UUID 格式但 assigneeId 为空的需求
 * 2. 通过 UUID 在 users 表查找用户
 * 3. 如果找到，更新 assignee 为用户名，assigneeId 为用户 ID
 * 4. 如果找不到，清空 assignee（避免误导）
 */

import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  console.log('🔍 查找悬空的 assignee 数据...');

  // 找出所有 assignee 为 UUID 格式的需求
  const orphans = await prisma.requirement.findMany({
    where: {
      assignee: { not: null },
      assigneeId: null,
    },
    select: {
      id: true,
      title: true,
      assignee: true,
    },
  });

  if (orphans.length === 0) {
    console.log('✅ 没有悬空的 assignee 数据');
    return;
  }

  console.log(`📊 找到 ${orphans.length} 个悬空的 assignee：`);

  let fixed = 0;
  let notFound = 0;

  for (const req of orphans) {
    const assigneeStr = req.assignee!;
    
    // 检查是否是 UUID 格式
    if (!UUID_REGEX.test(assigneeStr)) {
      console.log(`  ⏭️  跳过 ${req.id.substring(0, 8)} - 不是 UUID 格式: ${assigneeStr}`);
      continue;
    }

    console.log(`  📝 处理 ${req.id.substring(0, 8)} - ${req.title.substring(0, 40)}...`);
    console.log(`     当前 assignee: ${assigneeStr}`);

    // 通过 UUID 在 users 表查找用户
    const user = await prisma.user.findUnique({
      where: { id: assigneeStr },
      select: { id: true, name: true, email: true },
    });

    if (user) {
      // 找到了，更新 assignee 为用户名，assigneeId 为用户 ID
      await prisma.requirement.update({
        where: { id: req.id },
        data: {
          assignee: user.name,
          assigneeId: user.id,
        },
      });
      console.log(`     ✅ 修复成功 → assignee: ${user.name}, assigneeId: ${user.id}`);
      fixed++;
    } else {
      // 找不到，清空 assignee（避免误导）
      await prisma.requirement.update({
        where: { id: req.id },
        data: {
          assignee: null,
        },
      });
      console.log(`     ⚠️  用户不存在，清空 assignee`);
      notFound++;
    }
  }

  console.log('\n📈 修复完成：');
  console.log(`  ✅ 成功修复: ${fixed} 个`);
  console.log(`  ⚠️  清空无效: ${notFound} 个`);
  console.log(`  📊 总计处理: ${orphans.length} 个`);
}

main()
  .then(() => {
    console.log('\n✅ 脚本执行完成');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ 脚本执行失败:', err);
    process.exit(1);
  });
