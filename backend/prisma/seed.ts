import bcrypt from 'bcrypt';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const password = await bcrypt.hash('PASSWORD_REMOVED_BY_SECURITY_CLEANUP', 10);
  const requesterPassword = await bcrypt.hash('requester123', 10);
  const developerPassword = await bcrypt.hash('developer123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@agent.dev' },
    update: {},
    create: {
      name: 'CTO',
      email: 'admin@agent.dev',
      password,
      role: 'admin'
    }
  });

  await prisma.user.upsert({
    where: { email: 'requester@agent.dev' },
    update: {},
    create: {
      name: '业务需求方',
      email: 'requester@agent.dev',
      password: requesterPassword,
      role: 'requester'
    }
  });

  await prisma.user.upsert({
    where: { email: 'frontend@agent.dev' },
    update: {},
    create: {
      name: 'frontend-engineer',
      email: 'frontend@agent.dev',
      password: developerPassword,
      role: 'developer'
    }
  });

  const requirement = await prisma.requirement.upsert({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-4111-8111-111111111111',
      title: '搭建需求提交与审核闭环',
      description:
        '实现需求提交、CTO 审核、开发 Agent 分配、看板流转和完成验收的 MVP 流程。',
      priority: 'P1',
      status: 'approved',
      requester: '业务需求方',
      department: '平台产品',
      assignee: 'frontend-engineer',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  await prisma.task.upsert({
    where: { id: '22222222-2222-4222-8222-222222222222' },
    update: {},
    create: {
      id: '22222222-2222-4222-8222-222222222222',
      requirementId: requirement.id,
      title: '实现需求列表和看板视图',
      description: '用 React + Ant Design 实现需求筛选、详情管理和拖拽看板。',
      agentType: 'frontend-engineer',
      status: 'todo'
    }
  });

  console.log('Seed completed.');
  console.log('Admin: admin@agent.dev / PASSWORD_REMOVED_BY_SECURITY_CLEANUP');
  console.log('Requester: requester@agent.dev / requester123');
  console.log('Developer: frontend@agent.dev / developer123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
