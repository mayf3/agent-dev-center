/**
 * seed-marketplace-agents.ts
 *
 * 从 users 表提取 Agent 用户，写入 marketplace_agents 表。
 * 解决 prisma db push --accept-data-loss 后表空导致 OKR Agent 名称不显示的问题。
 *
 * 运行方式: npx tsx src/scripts/seed-marketplace-agents.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Agent 用户 → marketplace_agents 映射
// 基于 AGENTS.md 中的 48 个用户账号和 ADC 平台账号清单
const AGENT_DEFINITIONS = [
  { name: 'cto-agent', displayName: '技术研发总监', description: 'CTO Agent — 技术架构决策、代码审查、部署审批' },
  { name: 'agent-dev-engineer', displayName: '后端开发工程师', description: '后端开发 Agent — API 设计、数据库、业务逻辑' },
  { name: 'frontend-agent', displayName: '前端开发工程师', description: '前端开发 Agent — UI/UX、组件开发、页面实现' },
  { name: 'game-dev-agent', displayName: '游戏开发工程师', description: '游戏开发 Agent — 游戏逻辑、引擎开发' },
  { name: 'itops-agent', displayName: 'IT运维助手', description: 'IT运维 Agent — 部署、监控、服务器管理' },
  { name: 'test-engineer-agent', displayName: '测试工程师', description: '测试 Agent — 自动化测试、质量保障' },
  { name: 'qa-reviewer-agent', displayName: 'QA审查员', description: 'QA Agent — 代码审查、安全审查、质量把关' },
  { name: 'ceo-agent', displayName: 'CEO', description: 'CEO Agent — 战略决策、业务审批' },
  { name: 'efficiency-agent', displayName: '效率管家', description: '效率管理 Agent — OKR、效率分析、流程优化' },
  { name: 'security-agent', displayName: '安全工程师', description: '安全 Agent — 安全扫描、漏洞修复、安全策略' },
  { name: 'education-agent', displayName: '教育导师', description: '教育 Agent — 学习指导、知识管理' },
  { name: 'pm-agent', displayName: '产品经理', description: 'PM Agent — 需求分析、产品规划' },
  { name: 'hr-agent', displayName: 'HR经理', description: 'HR Agent — 人力资源管理、员工信息维护' },
  { name: 'finance-agent', displayName: '财务经理', description: '财务 Agent — 财务管理、成本分析' },
  { name: 'design-agent', displayName: 'UI设计师', description: '设计 Agent — UI/UX 设计、视觉规范' },
  { name: 'data-agent', displayName: '数据分析师', description: '数据 Agent — 数据分析、报表生成' },
  { name: 'devops-agent', displayName: 'DevOps工程师', description: 'DevOps Agent — CI/CD、自动化部署' },
  { name: 'sre-agent', displayName: 'SRE工程师', description: 'SRE Agent — 站点可靠性、故障排查' },
  { name: 'doc-agent', displayName: '文档工程师', description: '文档 Agent — 技术文档、API 文档' },
];

async function main() {
  console.log('🌱 Seeding marketplace_agents...');

  // 获取所有用户
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, internalRole: true },
  });
  console.log(`Found ${users.length} users`);

  let created = 0;
  let skipped = 0;
  let linked = 0;

  for (const def of AGENT_DEFINITIONS) {
    // 检查是否已存在
    const existing = await prisma.marketplaceAgent.findFirst({
      where: { name: def.name },
    });

    if (existing) {
      // 已存在，检查是否需要关联 userId
      if (!existing.userId) {
        const user = users.find(u => u.email?.startsWith(def.name) || u.name === def.displayName);
        if (user) {
          await prisma.marketplaceAgent.update({
            where: { id: existing.id },
            data: { userId: user.id, ownerId: user.id },
          });
          linked++;
          console.log(`  🔗 Linked ${def.name} → user ${user.email}`);
        }
      }
      skipped++;
      continue;
    }

    // 查找对应的用户
    const user = users.find(u =>
      u.email?.startsWith(def.name) ||
      u.email?.startsWith(def.name.replace(/-/g, '_')) ||
      u.email?.startsWith(def.name.replace(/-/g, '')) ||
      u.name === def.displayName
    );

    const agent = await prisma.marketplaceAgent.create({
      data: {
        name: def.name,
        displayName: def.displayName,
        description: def.description,
        capabilities: [],
        status: 'active',
        registrationSource: 'seed',
        ownerId: user?.id,
        userId: user?.id,
      },
    });

    created++;
    console.log(`  ✅ Created ${def.name} (${def.displayName})${user ? ` → user ${user.email}` : ''}`);
  }

  // 额外：从 users 表找 agent 类型用户但没有 marketplace 记录的
  const agentUsers = users.filter(u =>
    u.email?.includes('agent') ||
    u.email?.includes('@example.com') ||
    u.email?.includes('@example.com')
  );

  for (const user of agentUsers) {
    const alreadyLinked = await prisma.marketplaceAgent.findFirst({
      where: {
        OR: [
          { userId: user.id },
          { ownerId: user.id },
        ],
      },
    });

    if (alreadyLinked) continue;

    // 检查名字是否在定义里（跳过已经在上面处理过的）
    const nameFromEmail = user.email?.split('@')[0] || '';
    const alreadyDefined = AGENT_DEFINITIONS.some(d =>
      nameFromEmail.startsWith(d.name) || nameFromEmail.startsWith(d.name.replace(/-/g, ''))
    );
    if (alreadyDefined) continue;

    // 创建新的 agent 记录
    await prisma.marketplaceAgent.create({
      data: {
        name: nameFromEmail || user.name || user.id.slice(0, 8),
        displayName: user.name || nameFromEmail,
        description: `${user.name} — ${user.role} (${user.internalRole || 'general'})`,
        capabilities: [],
        status: 'active',
        registrationSource: 'seed',
        ownerId: user.id,
        userId: user.id,
      },
    });
    created++;
    console.log(`  ✅ Auto-created agent for user ${user.email} (${user.name})`);
  }

  console.log(`\n📊 Summary: ${created} created, ${linked} linked, ${skipped} skipped`);

  // 验证
  const total = await prisma.marketplaceAgent.count();
  console.log(`Total marketplace_agents: ${total}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
