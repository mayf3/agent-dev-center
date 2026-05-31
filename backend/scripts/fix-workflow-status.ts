/**
 * 批量修复工作流 status/assignee 不一致问题
 * 
 * 问题：
 * 1. 20个 status=approved + currentStep=dev_self_check → status 应为 in_progress
 * 2. 4个 status=in-progress + currentStep=testing → status 应为 testing，assignee 应为 test-engineer
 * 
 * 用法: npx tsx scripts/fix-workflow-status.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_ENGINEER_ID = '2af1e38f-5cb8-4bb0-ac9c-ce8b98b5b10e';

async function main() {
  console.log('=== 开始批量修复工作流 status/assignee ===\n');

  // Fix 1: approved + dev_self_check → in_progress
  const fix1 = await prisma.requirement.updateMany({
    where: {
      status: 'approved',
      currentStep: 'dev_self_check',
      workflowId: { not: null },
    },
    data: { status: 'in-progress' },
  });
  console.log(`✅ Fix 1: ${fix1.count} 个 approved+dev_self_check → in-progress`);

  // Fix 2: in-progress + testing → testing status + test-engineer assignee
  const fix2status = await prisma.requirement.updateMany({
    where: {
      status: 'in-progress',
      currentStep: 'testing',
      workflowId: { not: null },
    },
    data: { status: 'testing' },
  });
  console.log(`✅ Fix 2a: ${fix2status.count} 个 in-progress+testing → testing`);

  // Fix 2b: update assignee for testing step
  const fix2assignee = await prisma.requirement.updateMany({
    where: {
      currentStep: 'testing',
      workflowId: { not: null },
      assigneeId: { not: TEST_ENGINEER_ID },
    },
    data: { assigneeId: TEST_ENGINEER_ID },
  });
  console.log(`✅ Fix 2b: ${fix2assignee.count} 个 testing 步骤的 assignee → test-engineer`);

  // Verify
  console.log('\n=== 验证修复结果 ===');
  const remaining = await prisma.requirement.findMany({
    where: {
      workflowId: { not: null },
      status: { notIn: ['done', 'rejected', 'cancelled'] },
    },
    select: { id: true, status: true, currentStep: true, assigneeId: true },
  });

  const expected: Record<string, string> = {
    dev_self_check: 'in-progress',
    testing: 'testing',
    security_review: 'review',
    cto_review: 'review',
    deploying: 'deploying',
    done: 'done',
  };

  let issues = 0;
  for (const r of remaining) {
    const exp = expected[r.currentStep ?? ''];
    if (exp && r.status !== exp) {
      console.log(`  ⚠️ ${r.id.slice(0,8)} status=${r.status} step=${r.currentStep} (期望 ${exp})`);
      issues++;
    }
  }
  console.log(`\n剩余不一致: ${issues} 个`);
  console.log('=== 修复完成 ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
