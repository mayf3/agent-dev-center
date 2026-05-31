/**
 * fix-assignee-consistency.ts
 * 
 * 一次性修复：将所有 requirements 的 assigneeId 修复为当前 currentStep 对应的角色用户
 * 
 * 安全规则：
 * - 必须先跑 --dry-run 查看影响范围
 * - 确认无误后不加参数运行
 * 
 * 运行: npx tsx scripts/fix-assignee-consistency.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

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
  console.log(`=== 修复 assignee 一致性 ${DRY_RUN ? '🔍 DRY RUN' : '🚀 LIVE'} ===\n`);

  // 1. 获取所有活跃工作流需求
  const requirements = await prisma.requirement.findMany({
    where: {
      workflowId: { not: null },
      status: { notIn: ['done', 'rejected'] },
    },
    include: { workflow: true },
  });

  console.log(`活跃工作流需求: ${requirements.length} 个\n`);

  // 2. 获取用户映射
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, internalRole: true },
  });
  const userById = new Map(users.map(u => [u.id, u]));
  
  // internalRole → 第一个用户
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

  // 3. 模板缓存
  const templates = await prisma.workflowTemplate.findMany({
    where: { isActive: true },
  });
  const templateById = new Map(templates.map(t => [t.id, t]));

  // 4. 逐个检查
  const fixes: Array<{ id: string; shortId: string; step: string; role: string; oldId: string | null; oldName: string | null; newId: string; newName: string }> = [];

  for (const req of requirements) {
    const template = templateById.get(req.workflowId!);
    if (!template || !req.currentStep) continue;

    const steps = template.steps as Array<{ name: string; role: string }>;
    const currentStepDef = steps.find(s => s.name === req.currentStep);
    if (!currentStepDef) continue;

    const expectedRole = STEP_ROLE_TO_INTERNAL[currentStepDef.role];
    const expectedUser = expectedRole ? roleToUser.get(expectedRole) : null;
    if (!expectedUser) continue;

    // assigneeId 是否正确？
    if (req.assigneeId !== expectedUser.id || (req.assigneeId && req.assignee !== expectedUser.name)) {
      fixes.push({
        id: req.id,
        shortId: req.id.slice(0, 8),
        step: req.currentStep,
        role: currentStepDef.role,
        oldId: req.assigneeId,
        oldName: req.assignee,
        newId: expectedUser.id,
        newName: expectedUser.name,
      });
    }
  }

  if (fixes.length === 0) {
    console.log('✅ 所有需求的 assignee 已正确，无需修复');
    await prisma.$disconnect();
    return;
  }

  // 5. 显示影响
  console.log(`需要修复: ${fixes.length} 个\n`);
  for (const f of fixes) {
    console.log(`  ${f.shortId}: step=${f.step}(${f.role}) "${f.oldName ?? '(空)'}"(ID: ${f.oldId?.slice(0, 8) ?? '空'}) → "${f.newName}"(ID: ${f.newId.slice(0, 8)})`);
  }

  if (DRY_RUN) {
    console.log(`\n⚠️  DRY RUN — 未执行实际修改。去掉 --dry-run 运行以执行修复。`);
    await prisma.$disconnect();
    return;
  }

  // 6. 执行修复
  console.log(`\n=== 执行修复 (${fixes.length} 个) ===`);
  for (const f of fixes) {
    await prisma.requirement.update({
      where: { id: f.id },
      data: { assigneeId: f.newId, assignee: f.newName },
    });
    console.log(`  ✅ ${f.shortId}: ${f.oldName ?? '空'} → ${f.newName}`);
  }

  // 7. 验证
  console.log(`\n=== 验证 ===`);
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
        console.log(`❌ ${req.id.slice(0, 8)}: assignee="${req.assignee}" ≠ assigneeUser.name="${user.name}"`);
      }
    }
  }
  console.log(`剩余不一致: ${inconsistentCount} 个`);
  console.log(`修复完成 ✅`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
