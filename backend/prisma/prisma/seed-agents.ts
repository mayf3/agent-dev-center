import { prisma } from '../../src/lib/prisma.js';

// Layer mapping for agents
const LAYERS = ['main', 'exploration', 'life', 'infra', 'cross-cutting'] as const;

// Agent definitions with layers, pipelines, and display info
const AGENTS = [
  // ─── Main Layer (核心管线 Agent) ───────────────────────
  { name: 'content-agent', displayName: '内容生产 Agent', pipeline: 'content', tags: ['main'], description: '负责内容生产管线的内容生成、编辑和发布' },
  { name: 'content-reviewer', displayName: '内容审核 Agent', pipeline: 'content', tags: ['main'], description: '内容质量和合规审核' },
  { name: 'content-distributor', displayName: '内容分发 Agent', pipeline: 'content', tags: ['main'], description: '内容分发到各渠道' },
  { name: 'content-analytics', displayName: '内容分析 Agent', pipeline: 'content', tags: ['main'], description: '内容效果数据和用户行为分析' },
  { name: 'stock-analyst', displayName: '股票分析 Agent', pipeline: 'investment', tags: ['main'], description: '股票数据分析和投资建议' },
  { name: 'portfolio-manager', displayName: '投资组合经理', pipeline: 'investment', tags: ['main'], description: '投资组合管理和风险评估' },
  { name: 'market-research', displayName: '市场研究 Agent', pipeline: 'investment', tags: ['main'], description: '市场趋势和行业研究' },
  { name: 'trading-executor', displayName: '交易执行 Agent', pipeline: 'investment', tags: ['main'], description: '执行交易策略和订单管理' },
  { name: 'parenting-advisor', displayName: '育儿顾问', pipeline: 'parenting', tags: ['main'], description: '育儿知识建议和成长追踪' },
  { name: 'child-developer', displayName: '儿童发展评估', pipeline: 'parenting', tags: ['main'], description: '儿童发展阶段评估和里程碑追踪' },

  // ─── Exploration Layer (探索管线 Agent) ─────────────────
  { name: 'idea-generator', displayName: '创意发现 Agent', pipeline: 'planning', tags: ['exploration'], description: '新想法、新趋势的发现和筛选' },
  { name: 'prototype-builder', displayName: '原型构建 Agent', pipeline: 'planning', tags: ['exploration'], description: '快速原型开发和概念验证' },
  { name: 'experiment-runner', displayName: '实验运行 Agent', pipeline: 'planning', tags: ['exploration'], description: 'AB测试和实验管理' },
  { name: 'research-assistant', displayName: '研究助手', pipeline: 'education', tags: ['exploration'], description: '文献调研和技术研究' },
  { name: 'trend-scanner', displayName: '趋势扫描 Agent', pipeline: 'planning', tags: ['exploration'], description: '行业趋势和技术前沿追踪' },
  { name: 'data-miner', displayName: '数据挖掘 Agent', pipeline: 'planning', tags: ['exploration'], description: '数据探索和模式发现' },
  { name: 'hypothesis-tester', displayName: '假设验证 Agent', pipeline: 'education', tags: ['exploration'], description: '科学假设设计和验证' },

  // ─── Life Layer (生活管线 Agent) ────────────────────────
  { name: 'health-monitor', displayName: '健康监测 Agent', pipeline: 'health', tags: ['life'], description: '健康数据追踪和异常预警' },
  { name: 'fitness-coach', displayName: '健身教练 Agent', pipeline: 'health', tags: ['life'], description: '个性化健身计划和指导' },
  { name: 'diet-planner', displayName: '饮食规划 Agent', pipeline: 'health', tags: ['life'], description: '营养分析和饮食建议' },
  { name: 'sleep-optimizer', displayName: '睡眠优化 Agent', pipeline: 'health', tags: ['life'], description: '睡眠质量分析和改善建议' },
  { name: 'calendar-manager', displayName: '日程管理 Agent', pipeline: 'lifestyle', tags: ['life'], description: '日程安排和时间管理' },
  { name: 'finance-tracker', displayName: '财务追踪 Agent', pipeline: 'lifestyle', tags: ['life'], description: '个人财务管理和预算规划' },
  { name: 'shopping-assistant', displayName: '购物助手', pipeline: 'lifestyle', tags: ['life'], description: '智能购物建议和比价' },
  { name: 'travel-planner', displayName: '旅行规划 Agent', pipeline: 'lifestyle', tags: ['life'], description: '旅行行程规划和推荐' },
  { name: 'note-taker', displayName: '笔记整理 Agent', pipeline: 'education', tags: ['life'], description: '笔记整理和知识管理' },

  // ─── Infra Layer (基础设施 Agent) ───────────────────────
  { name: 'deployment-agent', displayName: '部署管理 Agent', pipeline: 'devops', tags: ['infra'], description: '自动化部署和发布管理' },
  { name: 'monitoring-agent', displayName: '监控告警 Agent', pipeline: 'devops', tags: ['infra'], description: '系统监控和异常告警' },
  { name: 'backup-manager', displayName: '备份管理 Agent', pipeline: 'devops', tags: ['infra'], description: '数据备份和灾难恢复' },
  { name: 'security-scanner', displayName: '安全扫描 Agent', pipeline: 'devops', tags: ['infra'], description: '安全漏洞扫描和合规检查' },
  { name: 'database-operator', displayName: '数据库运维 Agent', pipeline: 'devops', tags: ['infra'], description: '数据库运维和性能优化' },
  { name: 'network-manager', displayName: '网络管理 Agent', pipeline: 'devops', tags: ['infra'], description: '网络配置和流量管理' },
  { name: 'log-analyzer', displayName: '日志分析 Agent', pipeline: 'devops', tags: ['infra'], description: '日志收集和智能分析' },
  { name: 'ci-cd-agent', displayName: 'CI/CD 管理 Agent', pipeline: 'devops', tags: ['infra'], description: '持续集成和持续交付管理' },
  { name: 'auth-manager', displayName: '权限管理 Agent', pipeline: 'devops', tags: ['infra'], description: '身份认证和权限控制' },

  // ─── Cross-cutting Layer (跨层 Agent) ──────────────────
  { name: 'frontend-engineer', displayName: '前端开发 Agent', pipeline: 'devops', tags: ['cross-cutting'], description: 'Web 前端开发和维护' },
  { name: 'backend-engineer', displayName: '后端开发 Agent', pipeline: 'devops', tags: ['cross-cutting'], description: '后端服务和 API 开发' },
  { name: 'mobile-engineer', displayName: '移动端开发 Agent', pipeline: 'devops', tags: ['cross-cutting'], description: 'iOS/Android 应用开发' },
  { name: 'fullstack-engineer', displayName: '全栈开发 Agent', pipeline: 'devops', tags: ['cross-cutting'], description: '前后端全栈开发' },
  { name: 'qa-engineer', displayName: '测试工程师', pipeline: 'devops', tags: ['cross-cutting'], description: '功能测试和自动化测试' },
  { name: 'product-manager', displayName: '产品经理', pipeline: 'planning', tags: ['cross-cutting'], description: '产品规划和需求管理' },
  { name: 'ux-designer', displayName: 'UX 设计师', pipeline: 'planning', tags: ['cross-cutting'], description: '用户体验设计和交互设计' },
  { name: 'data-engineer', displayName: '数据工程师', pipeline: 'devops', tags: ['cross-cutting'], description: '数据管道和 ETL 开发' },
  { name: 'ml-engineer', displayName: '机器学习工程师', pipeline: 'education', tags: ['cross-cutting'], description: '模型训练和部署' },
  { name: 'tech-writer', displayName: '技术文档师', pipeline: 'content', tags: ['cross-cutting'], description: '技术文档和 API 文档编写' },
  { name: 'code-reviewer', displayName: '代码审查 Agent', pipeline: 'devops', tags: ['cross-cutting'], description: '代码质量审查和规范检查' },
  { name: 'knowledge-manager', displayName: '知识管理 Agent', pipeline: 'education', tags: ['cross-cutting'], description: '知识库维护和知识图谱更新' },
  { name: 'scrum-master', displayName: 'Scrum Master', pipeline: 'planning', tags: ['cross-cutting'], description: '敏捷流程管理和迭代优化' },
  { name: 'comms-agent', displayName: '沟通协调 Agent', pipeline: 'planning', tags: ['cross-cutting'], description: '团队沟通和信息同步' },
  { name: 'innovation-agent', displayName: '创新推进 Agent', pipeline: 'planning', tags: ['cross-cutting'], description: '创新项目推进和资源协调' },
];

// ─── Current month goals template ───────────────────────────

function generateMonthlyGoals(pipeline: string): Array<{ month: string; goals: Array<{ text: string; status: string }> }> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const nextMonth = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().slice(0, 7);

  const pipelineGoalTemplates: Record<string, string[]> = {
    content: ['完成 20 篇内容生产', '内容审核通过率 ≥ 95%', '拓展 3 个新内容渠道', '优化推荐算法'],
    investment: ['完成月度投资报告', '投资组合收益率 > 基准 2%', '风险评级更新', '市场趋势月度分析'],
    parenting: ['发布 10 篇育儿指南', '用户成长记录同步', '里程碑追踪覆盖率 100%', '家长反馈收集'],
    health: ['健康数据每日同步', '异常预警响应 < 30 分钟', '月度健康报告生成', '个性化建议推送'],
    lifestyle: ['日程冲突提前预警', '月度支出报告生成', '购物比价准确率 > 98%', '旅行规划模板更新'],
    planning: ['完成产品路线图更新', '需求反馈闭环率 > 90%', '原型评审时间 < 2 天', '实验报告自动化'],
    devops: ['部署成功率 > 99%', '监控覆盖率 100%', '告警误报率 < 5%', '安全漏洞修复 < 24h'],
    education: ['知识点入库 50 条', '学习路径优化', '测验准确率评估', '知识图谱更新'],
  };

  const goals = pipelineGoalTemplates[pipeline] || ['完成月度 OKR 设定', '周报按时提交', '自检率达到标准'];

  return [
    {
      month: currentMonth,
      goals: goals.slice(0, 4).map((text, i) => ({
        text,
        status: i === 0 ? 'in_progress' : i === 1 ? 'done' : 'not_started',
      })),
    },
    {
      month: nextMonth,
      goals: goals.slice(0, 4).map((text) => ({
        text,
        status: 'not_started',
      })),
    },
  ];
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding agents and goal cards...\n');

  let created = 0;
  let skipped = 0;

  for (const agentDef of AGENTS) {
    // Check if agent already exists
    const existing = await prisma.marketplaceAgent.findUnique({
      where: { name: agentDef.name },
    });

    if (existing) {
      // Update tags
      await prisma.marketplaceAgent.update({
        where: { name: agentDef.name },
        data: { tags: agentDef.tags },
      });
      skipped++;
      continue;
    }

    // Create agent
    const agent = await prisma.marketplaceAgent.create({
      data: {
        name: agentDef.name,
        displayName: agentDef.displayName,
        description: agentDef.description,
        tags: agentDef.tags,
        status: 'active',
        capabilities: [
          `pipeline:${agentDef.pipeline}`,
          `layer:${agentDef.tags[0]}`,
        ],
        notificationType: 'polling',
      },
    });

    // Create goal card for this agent
    const monthlyGoals = generateMonthlyGoals(agentDef.pipeline);
    await prisma.agentGoalCard.create({
      data: {
        agentId: agent.id,
        pipeline: agentDef.pipeline as any,
        longTermDirection: `作为${agentDef.displayName}，长期致力于${agentDef.description}，持续提升服务质量和效率。`,
        monthlyGoals: monthlyGoals as any,
        selfCheckCriteria: '1. 月度目标完成率 ≥ 70%\n2. 周报按时提交率 100%\n3. 自检无重大遗漏\n4. 下游依赖按时交付',
        status: 'active',
        upstreamAgentIds: [],
        downstreamAgentIds: [],
        pushedMonths: [],
      },
    });

    created++;
    console.log(`  ✅ ${agentDef.displayName} (${agentDef.tags.join(', ')})`);
  }

  console.log(`\n📊 Summary: ${created} created + ${skipped} updated = ${created + skipped} total`);

  // Print layer counts
  const layerCounts: Record<string, number> = {};
  for (const a of AGENTS) {
    const layer = a.tags[0];
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
  }
  console.log('\n📋 Layer distribution:');
  for (const [layer, count] of Object.entries(layerCounts)) {
    console.log(`  ${layer}: ${count} agents`);
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
