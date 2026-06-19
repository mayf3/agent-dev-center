/**
 * Cron Cleanup: Pending Reports Fallback
 *
 * df1e4527: 定时扫描终态需求（done / abandoned）的残留 pending 报告，
 * 将其标记为 rejected。每 6 小时由 cron 触发。
 *
 * 用法: npx tsx src/scripts/cleanup-pending-reports.ts
 *
 * 退出码:
 *   0 — 成功（无论是否清理到报告）
 *   1 — 执行出错
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const startedAt = new Date();
  console.log(`[cleanup-pending-reports] 开始扫描 — ${startedAt.toISOString()}`);

  // 查找终态需求（done / abandoned）中仍有 pending 报告的记录
  const staleReports = await prisma.requirementReport.findMany({
    where: {
      status: 'pending',
      requirement: {
        currentStep: { in: ['done', 'abandoned'] },
      },
    },
    select: {
      id: true,
      requirementId: true,
      reportType: true,
      createdAt: true,
      requirement: {
        select: { id: true, title: true, currentStep: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (staleReports.length === 0) {
    console.log('[cleanup-pending-reports] ✅ 无残留 pending 报告');
    return;
  }

  console.log(`[cleanup-pending-reports] 发现 ${staleReports.length} 条残留 pending 报告`);

  // 按需求分组，批量处理
  const byRequirement = new Map<string, typeof staleReports>();
  for (const report of staleReports) {
    const list = byRequirement.get(report.requirementId) ?? [];
    list.push(report);
    byRequirement.set(report.requirementId, list);
  }

  let totalCleaned = 0;
  const summary: Array<{ requirementId: string; title: string; cleanedCount: number; reportTypes: string[] }> = [];

  for (const [requirementId, reports] of byRequirement) {
    const reportIds = reports.map(r => r.id);
    const reportTypes = reports.map(r => r.reportType);

    await prisma.requirementReport.updateMany({
      where: { id: { in: reportIds } },
      data: {
        status: 'rejected',
        reviewComment: `[cron-cleanup] 需求已处于终态，自动清理残留 pending 报告`,
        reviewedAt: new Date(),
      },
    });

    totalCleaned += reports.length;
    const title = reports[0].requirement?.title ?? '(unknown)';
    const step = reports[0].requirement?.currentStep ?? '(unknown)';
    summary.push({ requirementId, title, cleanedCount: reports.length, reportTypes });
    console.log(`  → ${requirementId.slice(0, 8)} [${step}] ${title.slice(0, 40)} — 清理 ${reports.length} 条: ${reportTypes.join(', ')}`);
  }

  const elapsed = Date.now() - startedAt.getTime();
  console.log(
    `[cleanup-pending-reports] ✅ 完成 — 清理 ${totalCleaned} 条报告，涉及 ${byRequirement.size} 个需求，耗时 ${elapsed}ms`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[cleanup-pending-reports] ❌ 执行失败:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
