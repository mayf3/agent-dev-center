import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';

// 生产环境禁止执行 seed
if (process.env.NODE_ENV === 'production') {
  console.log('Seed skipped: NODE_ENV is production.');
  process.exit(0);
}

async function main() {
  const password = await bcrypt.hash('agent2026', 10);
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

  const marketplaceAgents = [
    {
      name: 'cto-agent',
      displayName: 'CTO 技术总监',
      description: '负责技术决策和需求审批',
      avatar: '👔',
      capabilities: [{ name: '需求审批', description: '审批开发需求' }]
    },
    {
      name: 'dev-engineer',
      displayName: '后端开发工程师',
      description: '负责后端开发任务',
      avatar: '⚙️',
      capabilities: [
        { name: '后端开发', description: 'API设计和实现' },
        { name: '数据库设计', description: '数据库建模和优化' }
      ]
    },
    {
      name: 'ops-agent',
      displayName: '运维工程师',
      description: '负责部署和监控',
      avatar: '🔧',
      capabilities: [
        { name: '服务部署', description: '部署和发布服务' },
        { name: '健康监控', description: '服务健康检查' }
      ]
    }
  ];

  for (const agent of marketplaceAgents) {
    await prisma.marketplaceAgent.upsert({
      where: { name: agent.name },
      update: {
        displayName: agent.displayName,
        description: agent.description,
        avatar: agent.avatar,
        capabilities: agent.capabilities as Prisma.InputJsonValue,
        status: 'active'
      },
      create: {
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        avatar: agent.avatar,
        capabilities: agent.capabilities as Prisma.InputJsonValue,
        status: 'active'
      }
    });
  }

  console.log('Seed completed.');
  console.log('Admin: admin@agent.dev / agent2026');
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
