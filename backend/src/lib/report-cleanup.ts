/**
 * Report Cleanup Helper
 *
 * 清理需求关联的 pending 报告 — 将状态变更为 rejected（数据保留，不删除）。
 * 用于需求进入终态（done / abandoned）时自动清理。
 *
 * 2026-06-15: df1e4527 — 需求完成后 pending 报告未清理
 */

import { prisma } from './prisma.js';

export interface CleanupResult {
  requirementId: string;
  cleanedCount: number;
  reportTypes: string[];
}

/**
 * 将指定需求的 pending 报告全部标记为 rejected。
 * 必须在调用方的事务中执行（传入 tx client）。
 *
 * @param tx - Prisma transaction client
 * @param requirementId - 需求 ID
 * @param reason - 清理原因（记录到 reviewComment）
 * @returns 清理结果（清理数量 + 报告类型列表）
 */
export async function rejectPendingReports(
  tx: Parameters<Parameters<typeof prisma['$transaction']>[0]>[0],
  requirementId: string,
  reason: string,
): Promise<CleanupResult> {
  const pendingReports = await tx.requirementReport.findMany({
    where: {
      requirementId,
      status: 'pending',
    },
    select: { id: true, reportType: true },
  });

  if (pendingReports.length === 0) {
    return { requirementId, cleanedCount: 0, reportTypes: [] };
  }

  const reportTypes = pendingReports.map(r => r.reportType);

  // 批量更新：status → rejected，记录清理原因
  await tx.requirementReport.updateMany({
    where: {
      id: { in: pendingReports.map(r => r.id) },
    },
    data: {
      status: 'rejected',
      reviewComment: `[auto-cleanup] ${reason}`,
      reviewedAt: new Date(),
    },
  });

  console.log(
    `[report-cleanup] 需求 ${requirementId.slice(0, 8)} 清理 ${pendingReports.length} 条 pending 报告: ${reportTypes.join(', ')}`,
  );

  return {
    requirementId,
    cleanedCount: pendingReports.length,
    reportTypes,
  };
}
