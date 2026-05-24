import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { runOverdueCheck } from './utils/overdue-check.js';
import { startupSSOCheck } from './middleware/sso-config-guard.js';

// 启动时 SSO 配置自检（生产环境不通过则拒绝启动）
startupSSOCheck();

const server = app.listen(env.PORT, () => {
  console.log(`Agent开发中心 backend is running on http://localhost:${env.PORT}`);
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

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  clearInterval(overdueInterval);
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
