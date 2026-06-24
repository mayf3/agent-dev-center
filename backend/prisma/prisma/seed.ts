import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';

// 生产环境禁止执行 seed
if (process.env.NODE_ENV === 'production') {
  console.log('Seed skipped: NODE_ENV is production.');
  process.exit(0);
}

async function main() {
  const password = await bcrypt.hash('{your-test-password}', 10);
  const requesterPassword = await bcrypt.hash('{your-test-password}', 10);
  const developerPassword = await bcrypt.hash('{your-test-password}', 10);

  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'CTO',
      email: 'admin@example.com',
      password,
      role: 'admin'
    }
  });

  await prisma.user.upsert({
    where: { email: 'requester@example.com' },
    update: {},
    create: {
      name: '业务需求方',
      email: 'requester@example.com',
      password: requesterPassword,
      role: 'requester'
    }
  });

  await prisma.user.upsert({
    where: { email: 'frontend@example.com' },
    update: {},
    create: {
      name: 'frontend-engineer',
      email: 'frontend@example.com',
      password: developerPassword,
      role: 'developer'
    }
  });

  const projects = [
    {
      name: 'ADC Platform',
      description: 'AI Agent 团队的开发协作平台',
      status: 'active',
      featureList: [
        '- 需求提交、审核与流转',
        '- Agent 任务分配与看板',
        '- 验收报告、附件与评论',
        '- 团队身份、服务监控与复盘管理',
      ].join('\n'),
      boundaries: [
        '- 不替代具体业务系统',
        '- 不承载支付、交易或客户数据主流程',
        '- 不直接执行生产发布，仅管理协作和审计信息',
      ].join('\n'),
    },
    {
      name: 'svc-auth',
      description: '统一认证与授权服务',
      status: 'active',
      featureList: [
        '- 统一登录、Token 签发与校验',
        '- 用户、角色和权限策略管理',
        '- SSO 集成与跨服务身份透传',
      ].join('\n'),
      boundaries: [
        '- 不管理业务侧功能权限细节',
        '- 不保存业务系统私有配置',
        '- 不承担审计报表展示职责',
      ].join('\n'),
    },
    {
      name: 'svc-okr',
      description: 'OKR 目标管理平台',
      status: 'active',
      featureList: [
        '- Agent OKR 目标卡管理',
        '- 月度目标、KR 与推进状态',
        '- 目标与任务平台联动',
      ].join('\n'),
      boundaries: [
        '- 不存放具体 TODO 执行步骤',
        '- 不替代 ADC 的需求评审流转',
        '- 不管理个人健康、家庭或财务数据',
      ].join('\n'),
    },
    {
      name: 'itops-agent',
      description: '运维自动化 Agent',
      status: 'maintaining',
      featureList: [
        '- 服务健康检查与异常告警',
        '- 部署前后巡检',
        '- 常见运维动作自动化',
      ].join('\n'),
      boundaries: [
        '- 不绕过人工审批执行高风险变更',
        '- 不保存生产密钥明文',
        '- 不单独定义业务 SLO',
      ].join('\n'),
    },
    {
      name: 'Agent Marketplace',
      description: 'Agent 能力市场（已废弃）',
      status: 'deprecated',
      featureList: [
        '- Agent 能力展示',
        '- Marketplace 任务创建与交付记录',
        '- 能力标签和状态管理',
      ].join('\n'),
      boundaries: [
        '- 已废弃，不再作为新增能力入口',
        '- 不再扩展独立交易或结算能力',
        '- 后续能力治理并入 ADC Platform',
      ].join('\n'),
    },
  ];

  for (const project of projects) {
    await prisma.project.upsert({
      where: { name: project.name },
      update: {
        description: project.description,
        boundaries: project.boundaries,
        featureList: project.featureList,
        status: project.status,
      },
      create: project,
    });
  }

  const requirement = await prisma.requirement.upsert({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-4111-8111-111111111111',
      title: '搭建需求提交与审核闭环',
      description:
        '实现需求提交、CTO 审核、开发 Agent 分配、看板流转和完成验收的 MVP 流程。',
      priority: 'P1',
      currentStep: 'approved',
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
  console.log('Admin: admin@example.com / {your-test-password}');
  console.log('Requester: requester@example.com / {your-test-password}');
  console.log('Developer: frontend@example.com / {your-test-password}');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
