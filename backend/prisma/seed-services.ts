import { PrismaClient, ServiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

// ADC_PUBLIC_URL from environment or default to localhost
const PUBLIC_URL = process.env.ADC_PUBLIC_URL || 'http://localhost:4000';
// Project root placeholder (replace with actual path in local dev)
const PROJECT_ROOT = process.env.PROJECT_ROOT || '{project-root}';

async function main() {
  console.log('🌱 Seeding services...\n');

  const services = [
    {
      name: 'agent-dev-center-frontend',
      displayName: 'Agent Dev Center 前端',
      description: 'Agent 开发中心前端应用，包含需求看板、服务注册、能力集市等模块。React + Vite + Ant Design。',
      port: 5173,
      localUrl: 'http://localhost:5173',
      remoteUrl: `${PUBLIC_URL}/`,
      techStack: ['React', 'Vite', 'TypeScript', 'Ant Design'],
      owner: 'devtools-agent',
      gitRepo: `${PROJECT_ROOT}/agent-dev-center/frontend`,
      database: null,
      status: ServiceStatus.online,
      version: '1.5.0',
    },
    {
      name: 'agent-dev-center-backend',
      displayName: 'Agent Dev Center 后端',
      description: 'Agent 开发中心后端服务，提供需求管理、服务注册、能力集市、文件上传等 API。Express + Prisma + PostgreSQL。',
      port: 4000,
      localUrl: 'http://localhost:4000',
      remoteUrl: `${PUBLIC_URL}/api/health`,
      techStack: ['Node.js', 'Express', 'TypeScript', 'Prisma', 'PostgreSQL'],
      owner: 'agent-dev-engineer',
      gitRepo: `${PROJECT_ROOT}/agent-dev-center/backend`,
      database: 'PostgreSQL',
      status: ServiceStatus.online,
      version: '1.5.0',
    },
    {
      name: 'llm-todo-backend',
      displayName: 'LLM Todo 后端',
      description: 'LLM 驱动的智能待办系统后端，支持自然语言创建任务、智能分类和优先级排序。Express + SQLite。',
      port: 3001,
      localUrl: 'http://localhost:3458',
      remoteUrl: `${PUBLIC_URL}/todo/api/health`,
      techStack: ['Node.js', 'Express', 'TypeScript', 'SQLite'],
      owner: 'agent-dev-engineer',
      gitRepo: `${PROJECT_ROOT}/llm-todo`,
      database: 'SQLite',
      status: ServiceStatus.online,
      version: '1.2.0',
    },
    {
      name: 'llm-wiki-compiler',
      displayName: 'LLM Wiki 编译系统',
      description: 'LLM 知识库编译系统，负责 Wiki 内容的构建、索引和发布。Python 脚本集合。',
      port: null,
      localUrl: null,
      remoteUrl: null,
      techStack: ['Python', 'Markdown', 'LLM'],
      owner: 'agent-dev-engineer',
      gitRepo: `${PROJECT_ROOT}/llm-wiki`,
      database: null,
      status: ServiceStatus.offline,
      version: null,
    },
    {
      name: 'ops-dashboard',
      displayName: '运维监控面板',
      description: '服务器运维监控面板，实时展示系统资源使用情况、服务健康状态和告警信息。Docker API + Python。',
      port: null,
      localUrl: 'http://localhost:8088',
      remoteUrl: `${PUBLIC_URL.replace(/:\d+/, ':19999')}`,
      techStack: ['Python', 'Docker API', 'Flask'],
      owner: 'itops-agent',
      gitRepo: `${PROJECT_ROOT}/ops-dashboard`,
      database: null,
      status: ServiceStatus.online,
      version: '1.0.0',
    },
  ];

  for (const svc of services) {
    const result = await prisma.service.upsert({
      where: { name: svc.name },
      update: svc,
      create: svc,
    });
    console.log(`  ✅ ${result.displayName} (${result.name})`);
  }

  console.log(`\n✅ Seeded ${services.length} services`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
