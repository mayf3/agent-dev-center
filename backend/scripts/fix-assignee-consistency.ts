/**
 * fix-assignee-consistency.ts
 * 
 * 一次性修复：将所有 requirements 的 assignee 文本字段同步为 assigneeId 对应的 user.name
 * 并修复 assigneeId 指向错误用户的问题。
 * 
 * 运行: npx tsx scripts/fix-assignee-consistency.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 工作流步骤 role → InternalRole 映射
const STEP_ROLE_TO_INTERNAL: Record<string, string> = {
  developer: 'developer',
  tester: 'tester',
  security: 'security',
  cto: 'cto',
  admin: 'cto',
  ops: 'ops',
  pm: 'pm',
};

async function main() {
  console.log('=== 修复 assignee 一致性 ===\n');

  // 1. 获取所有活跃工作流需求
  const requirements = await prisma.requirement.findMany({
    where: {
      workflowId: { not: null },
      status: { notIn: ['done', 'rejected'] },
    },
    include: { workflow: true },
  });

  console.log(`活跃工作流需求: ${requirements.length} 个\n`);

  // 2. 获取所有用户的 ID → name 映射
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, internalRole: true },
  });
  const userById = new Map(users.map(u => [u.id, u]));
  
  // internalRole → 找到该角色的第一个用户
  const roleToUser = new Map<string, typeof users[0]>();
  for (const u of users) {
    if (u.internalRole && !roleToUser.has(u.internalRole)) {
      roleToUser.set(u.internalRole, u);
    }
  }

  console.log('角色 → 用户映射:');
  for (const [role, user] of roleToUser) {
    console.log(`  ${role} → ${user.name} (${user.id.slice(0, 8)})`);
  }
  console.log('');

  // 3. 获取所有工作流模板
  const templates = await prisma.workflowTemplate.findMany({
    where: { isActive: true },
  });
  const templateById = new Map(templates.map(t => [t.id, t]));

  // 4. 逐个检查并修复
  let fixCount = 0;
  let nameMismatchCount = 0;
  let idMismatchCount = 0;

  for (const req of requirements) {
    const template = templateById.get(req.workflowId!);
    if (!template || !req.currentStep) continue;

    const steps = template.steps as Array<{ name: string; role: string }>;
    const currentStepDef = steps.find(s => s.name === req.currentStep);
    if (!currentStepDef) continue;

    const expectedRole = STEP_ROLE_TO_INTERNAL[currentStepDef.role];
    const expectedUser = expectedRole ? roleToUser.get(expectedRole) : null;
    const currentAssigneeUser = req.assigneeId ? userById.get(req.assigneeId) : null;

    let needsFix = false;
    let newAssigneeId = req.assigneeId;
    let newAssigneeName = req.assignee;

    // 检查 assigneeId 是否指向正确角色
    if (expectedUser && req.assigneeId !== expectedUser.id) {
      newAssigneeId = expectedUser.id;
      newAssigneeName = expectedUser.name;
      needsFix = true;
      idMismatchCount++;
    }

    // 检查 assignee 名字是否与 assigneeId 对应
    if (newAssigneeId) {
      const targetUser = userById.get(newAssigneeId);
      if (targetUser && req.assignee !== targetUser.name) {
        newAssigneeName = targetUser.name;
        needsFix = true;
        nameMismatchCount++;
      }
    }

    if (needsFix) {
      await prisma.requirement.update({
        where: { id: req.id },
        data: {
          assigneeId: newAssigneeId,
          assignee: newAssigneeName,
        },
      });
      fixCount++;
      console.log(`✅ ${req.id.slice(0, 8)}: step=${req.currentStep}(${currentStepDef.role}) → ${newAssigneeName} (${newAssigneeId!.slice(0, 8)})`);
    }
  }

  console.log(`\n=== 修复完成 ===`);
  console.log(`修复数量: ${fixCount} 个`);
  console.log(`  assigneeId 不匹配: ${idMismatchCount}`);
  console.log(`  assignee 名字不匹配: ${nameMismatchCount}`);

  // 5. 验证
  const remaining = await prisma.requirement.findMany({
    where: {
      workflowId: { not: null },
      status: { notIn: ['done', 'rejected'] },
    },
    select: { id: true, assigneeId: true, assignee: true },
  });

  let inconsistentCount = 0;
  for (const req of remaining) {
    if (req.assigneeId) {
      const user = userById.get(req.assigneeId);
      if (user && req.assignee !== user.name) {
        inconsistentCount++;
        console.log(`❌ 不一致: ${req.id.slice(0, 8)} assigneeId=${req.assigneeId.slice(0, 8)} → name should be "${user.name}" but is "${req.assignee}"`);
      }
    }
  }
  console.log(`\n剩余不一致: ${inconsistentCount} 个`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
