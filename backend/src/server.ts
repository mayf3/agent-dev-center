import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { runOverdueCheck } from './utils/overdue-check.js';
import { checkTestEnvLockTTL } from './utils/test-env-lock-monitor.js';
import { startupSSOCheck } from './middleware/sso-config-guard.js';
import { ensureWorkflowTemplates } from './lib/workflow-templates.js';

// 启动时 SSO 配置自检（生产环境不通过则拒绝启动）
startupSSOCheck();

const server = app.listen(env.PORT, async () => {
  console.log(`Agent开发中心 backend is running on http://localhost:${env.PORT}`);
  // 启动时确保工作流模板存在
  try {
    await ensureWorkflowTemplates();
  } catch (err) {
    console.error('[startup] Failed to ensure workflow templates:', err);
  }

  // 启动时确保 marketplace_agents 有基础数据
  try {
    const { ensureMarketplaceAgents } = await import('./lib/seed-agents.js');
    await ensureMarketplaceAgents();
  } catch (err) {
    console.error('[startup] Failed to seed marketplace agents:', err);
  }
});

// ─── 自动催办 Cron ────────────────────────────────────────
// 每 1 小时检查一次超时需求
const OVERDUE_CRON_MS = 60 * 60 * 1000;
const overdueInterval = setInterval(async () => {
  try {
    const result = await runOverdueCheck();
    if (result.notStartedCount > 0 || result.stalledCount > 0) {
      console.log(
        `[overdue-cron] 催办: ${result.notStartedCount} 个未开始, ${result.stalledCount} 个停滞`,
      );
    }
  } catch (err) {
    console.error('[overdue-cron] error:', err);
  }
}, OVERDUE_CRON_MS);

// 启动后 30s 先跑一次
setTimeout(() => {
  void runOverdueCheck().catch(err => console.error('[overdue-cron] initial error:', err));
}, 30_000);

// ─── 测试环境锁 TTL 监控 Cron ──────────────────────────────
// 每 5 分钟检查一次锁持有时间，超时发飞书告警
const LOCK_TTL_CRON_MS = 5 * 60 * 1000;
const lockTtlInterval = setInterval(async () => {
  try {
    const result = await checkTestEnvLockTTL();
    if (result.warningCount > 0 || result.escalateCount > 0) {
      console.log(
        `[test-env-lock-monitor] 告警: ${result.warningCount} 个催办, ${result.escalateCount} 个升级`,
      );
    }
  } catch (err) {
    console.error('[test-env-lock-monitor] error:', err);
  }
}, LOCK_TTL_CRON_MS);

// 启动后 60s 先跑一次
setTimeout(() => {
  void checkTestEnvLockTTL().catch(err => console.error('[test-env-lock-monitor] initial error:', err));
}, 60_000);

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  clearInterval(overdueInterval);
  clearInterval(lockTtlInterval);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
