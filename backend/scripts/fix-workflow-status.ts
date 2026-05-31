/**
 * 批量修复工作流 status/currentStep 不一致问题
 * 
 * 场景覆盖：
 * 1. approved + dev_self_check → in_progress
 * 2. in_progress + testing → testing
 * 3. testing + security_review → review（advance 后 status 未同步）
 * 4. review + cto_review → review（已经是 review，无需修）
 * 5. testing 步骤 assignee → test-engineer
 * 6. security_review 步骤 assignee → security-agent
 * 
 * 用法: npx tsx scripts/fix-workflow-status.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_ENGINEER_ID = '2af1e38f-5cb8-4bb0-ac9c-ce8b98b5b10e';
const SECURITY_AGENT_ID = '1547db33-8814-4897-a00f-fde5b26e09b2';

// Prisma RequirementStatus enum 用下划线
const stepToStatus: Record<string, string> = {
  dev_self_check: 'in_progress',
  testing: 'testing',
  security_review: 'review',
  cto_review: 'review',
  deploying: 'deploying',
  done: 'done',
};

async function main() {
  console.log('=== 开始批量修复工作流 status/assignee ===\n');

  // 找出所有活跃的工作流需求
  const active = await prisma.requirement.findMany({
    where: {
      workflowId: { not: null },
      status: { notIn: ['done', 'rejected'] },
    },
    select: { id: true, status: true, currentStep: true, assigneeId: true },
  });

  console.log(`活跃工作流需求: ${active.length} 个\n`);

  let fixed = 0;

  for (const r of active) {
    const step = r.currentStep ?? '';
    const expectedStatus = stepToStatus[step];
    if (!expectedStatus) continue;

    const updates: Record<string, any> = {};
    if (r.status !== expectedStatus) {
      updates.status = expectedStatus;
    }

    // assignee 修正
    if (step === 'testing' && r.assigneeId !== TEST_ENGINEER_ID) {
      updates.assigneeId = TEST_ENGINEER_ID;
    }
    if (step === 'security_review' && r.assigneeId !== SECURITY_AGENT_ID) {
      updates.assigneeId = SECURITY_AGENT_ID;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.requirement.update({
        where: { id: r.id },
        data: updates,
      });
      const changes = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ');
      console.log(`  ✅ ${r.id.slice(0, 8)} ${changes}`);
      fixed++;
    }
  }

  console.log(`\n修复数量: ${fixed} 个`);

  // 验证
  console.log('\n=== 验证 ===');
  const remaining = await prisma.requirement.findMany({
    where: {
      workflowId: { not: null },
      status: { notIn: ['done', 'rejected'] },
    },
    select: { id: true, status: true, currentStep: true },
  });

  let issues = 0;
  for (const r of remaining) {
    const exp = stepToStatus[r.currentStep ?? ''];
    if (exp && r.status !== exp) {
      console.log(`  ⚠️ ${r.id.slice(0, 8)} status=${r.status} step=${r.currentStep} (期望 ${exp})`);
      issues++;
    }
  }
  console.log(`\n剩余不一致: ${issues} 个`);
  console.log('=== 修复完成 ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
