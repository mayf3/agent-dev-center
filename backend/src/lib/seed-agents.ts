/**
 * ensureMarketplaceAgents — 启动时自动 upsert 基础 Agent 数据
 *
 * 对 marketplace_agents 表做幂等 seed，确保每个 Agent 用户有对应的记录。
 * 解决 prisma db push --accept-data-loss 后表空的问题。
 */
import { prisma } from './prisma.js';

const SEED_AGENTS = [
  { name: 'cto-agent', displayName: '技术研发总监', desc: 'CTO Agent — 技术架构决策、代码审查、部署审批' },
  { name: 'agent-dev-engineer', displayName: '后端开发工程师', desc: '后端开发 Agent — API 设计、数据库、业务逻辑' },
  { name: 'frontend-agent', displayName: '前端开发工程师', desc: '前端开发 Agent — UI/UX、组件开发' },
  { name: 'game-dev-agent', displayName: '游戏开发工程师', desc: '游戏开发 Agent — 游戏逻辑、引擎开发' },
  { name: 'itops-agent', displayName: 'IT运维助手', desc: 'IT运维 Agent — 部署、监控、服务器管理' },
  { name: 'test-engineer-agent', displayName: '测试工程师', desc: '测试 Agent — 自动化测试、质量保障' },
  { name: 'qa-reviewer-agent', displayName: 'QA审查员', desc: 'QA Agent — 代码审查、安全审查' },
  { name: 'ceo-agent', displayName: 'CEO', desc: 'CEO Agent — 战略决策、业务审批' },
  { name: 'efficiency-agent', displayName: '效率管家', desc: '效率管理 Agent — OKR、效率分析' },
  { name: 'security-agent', displayName: '安全工程师', desc: '安全 Agent — 安全扫描、漏洞修复' },
  { name: 'education-agent', displayName: '教育导师', desc: '教育 Agent — 学习指导、知识管理' },
  { name: 'pm-agent', displayName: '产品经理', desc: 'PM Agent — 需求分析、产品规划' },
  { name: 'hr-agent', displayName: 'HR经理', desc: 'HR Agent — 人力资源管理' },
  { name: 'finance-agent', displayName: '财务经理', desc: '财务 Agent — 财务管理' },
  { name: 'design-agent', displayName: 'UI设计师', desc: '设计 Agent — UI/UX 设计' },
  { name: 'data-agent', displayName: '数据分析师', desc: '数据 Agent — 数据分析、报表' },
  { name: 'devops-agent', displayName: 'DevOps工程师', desc: 'DevOps Agent — CI/CD、自动化部署' },
  { name: 'sre-agent', displayName: 'SRE工程师', desc: 'SRE Agent — 站点可靠性' },
  { name: 'doc-agent', displayName: '文档工程师', desc: '文档 Agent — 技术文档' },
];

export async function ensureMarketplaceAgents(): Promise<void> {
  // 快速检查：如果已有足够数据则跳过
  const count = await prisma.marketplaceAgent.count();
  if (count >= SEED_AGENTS.length) {
    return; // 已有数据，不需要 seed
  }

  console.log(`[seed-agents] marketplace_agents has ${count} rows, seeding...`);

  // 查找用户用于关联
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
  });

  let created = 0;
  for (const def of SEED_AGENTS) {
    const user = users.find(u =>
      u.email?.startsWith(def.name) ||
      u.email?.startsWith(def.name.replace(/-/g, '_')) ||
      u.email?.startsWith(def.name.replace(/-/g, ''))
    );

    try {
      await prisma.marketplaceAgent.upsert({
        where: { name: def.name },
        update: {
          displayName: def.displayName,
          description: def.desc,
          userId: user?.id,
          ownerId: user?.id,
        },
        create: {
          name: def.name,
          displayName: def.displayName,
          description: def.desc,
          capabilities: [],
          status: 'active',
          registrationSource: 'seed',
          userId: user?.id,
          ownerId: user?.id,
        },
      });
      created++;
    } catch (err: any) {
      // unique constraint on userId might fail if another agent already linked
      if (err?.code === 'P2002') {
        // userId already taken by another agent, skip linking
        try {
          await prisma.marketplaceAgent.upsert({
            where: { name: def.name },
            update: { displayName: def.displayName, description: def.desc },
            create: {
              name: def.name,
              displayName: def.displayName,
              description: def.desc,
              capabilities: [],
              status: 'active',
              registrationSource: 'seed',
            },
          });
          created++;
        } catch {
          // skip silently
        }
      } else {
        console.warn(`[seed-agents] Failed to upsert ${def.name}: ${err?.message}`);
      }
    }
  }

  const total = await prisma.marketplaceAgent.count();
  console.log(`[seed-agents] Done: ${created} upserted, total ${total} agents`);
}
