import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';

// 生产环境禁止执行 seed
if (process.env.NODE_ENV === 'production') {
  console.log('Seed skipped: NODE_ENV is production.');
  process.exit(0);
}

// 从环境变量读取 seed 密码，兜底用安全随机（开源后不暴露固定密码）
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'replace-with-your-secure-password';

async function main() {
  const password = await bcrypt.hash(SEED_PASSWORD, 10);

  const demoUsers = [
    { email: 'admin@example.com', name: 'Admin', role: 'admin' as const },
    { email: 'requester@example.com', name: 'Requester', role: 'requester' as const },
    { email: 'developer@example.com', name: 'Developer', role: 'developer' as const },
  ];

  for (const user of demoUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: {
        name: user.name,
        email: user.email,
        password,
        role: user.role,
      },
    });
  }

  const requirement = await prisma.requirement.upsert({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-4111-8111-111111111111',
      title: '搭建需求提交与审核闭环',
      description:
        '实现需求提交、审批、Agent 分配、看板流转和完成验收的 MVP 流程。',
      priority: 'P1',
      currentStep: 'approved',
      requester: 'Requester',
      department: 'Platform',
      assignee: 'Developer',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.task.upsert({
    where: { id: '22222222-2222-4222-8222-222222222222' },
    update: {},
    create: {
      id: '22222222-2222-4222-8222-222222222222',
      requirementId: requirement.id,
      title: '实现需求列表和看板视图',
      description: '用 React + Ant Design 实现需求筛选、详情管理和拖拽看板。',
      agentType: 'developer',
      status: 'todo',
    },
  });

  const marketplaceAgents = [
    {
      name: 'tech-lead',
      displayName: 'Tech Lead',
      description: '负责技术决策和需求审批',
      avatar: '👔',
      capabilities: [{ name: '需求审批', description: '审批开发需求' }],
    },
    {
      name: 'backend-engineer',
      displayName: '后端开发工程师',
      description: '负责后端开发任务',
      avatar: '⚙️',
      capabilities: [
        { name: '后端开发', description: 'API 设计和实现' },
        { name: '数据库设计', description: '数据库建模和优化' },
      ],
    },
    {
      name: 'ops-engineer',
      displayName: '运维工程师',
      description: '负责部署和监控',
      avatar: '🔧',
      capabilities: [
        { name: '服务部署', description: '部署和发布服务' },
        { name: '健康监控', description: '服务健康检查' },
      ],
    },
  ];

  for (const agent of marketplaceAgents) {
    await prisma.marketplaceAgent.upsert({
      where: { name: agent.name },
      update: {
        displayName: agent.displayName,
        description: agent.description,
        avatar: agent.avatar,
        capabilities: agent.capabilities as Prisma.InputJsonValue,
        status: 'active',
      },
      create: {
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        avatar: agent.avatar,
        capabilities: agent.capabilities as Prisma.InputJsonValue,
        status: 'active',
      },
    });
  }

  console.log('✅ Seed completed.');
  console.log(`   Users created with password: ${SEED_PASSWORD === 'replace-with-your-secure-password' ? '(please set SEED_PASSWORD env var)' : '(from SEED_PASSWORD env)'}`);
  console.log('   Emails: admin@example.com, requester@example.com, developer@example.com');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
