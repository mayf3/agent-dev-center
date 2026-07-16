import { prisma } from './src/lib/prisma.js';

async function main() {
  // 查询现有用户
  const users = await prisma.user.findMany({ take: 1 });
  if (users.length === 0) {
    console.log('No users found');
    await prisma.$disconnect();
    return;
  }

  const user = users[0];
  console.log('Using user:', user.id, user.name);

  // 创建测试需求
  const req = await prisma.requirement.create({
    data: {
      title: '测试审计需求',
      description: '用于测试审计 API',
      priority: 'P2',
      type: 'FEATURE',
      requester: user.name,
      requesterId: user.id,
      currentStep: 'pm_review',
      department: '平台',
    },
  });

  // 创建测试流转记录
  await prisma.workflowTransition.createMany({
    data: [
      {
        requirementId: req.id,
        fromStep: 'pending',
        toStep: 'pm_review',
        action: 'assign-workflow',
        actorName: 'CTO',
        actorRole: 'cto',
        comment: '分配工作流',
      },
      {
        requirementId: req.id,
        fromStep: 'pm_review',
        toStep: 'dev_self_check',
        action: 'advance',
        actorName: '产品经理',
        actorRole: 'pm',
        comment: 'PM 审批通过',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 天前
      },
    ],
  });

  console.log('Created test requirement:', req.id);
  console.log('Created 2 workflow transitions');

  // 查询验证
  const count = await prisma.workflowTransition.count();
  console.log('Total transitions:', count);

  await prisma.$disconnect();
}

main().catch(console.error);
