/**
 * fix-assignee-drift.ts — 批量修复现有需求 assignee 漂移
 *
 * 2026-06-14 (6c70be0a):
 * - 对已分配工作流的 draft 步骤需求：将 assignee 设回 requesterId
 * - 对已分配工作流的非 draft 需求：用 roleUserMap 重新解析正确的 assignee
 * - 无工作流的需求：跳过（不需要修复）
 *
 * 安全：只更新 assigneeId，不修改其他字段。可重复运行（幂等）。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 从模板 JSON 中提取 roleUserMap（兼容新旧格式） */
function extractRoleUserMap(stepsJson: unknown): Record<string, string> | undefined {
  if (!stepsJson || typeof stepsJson !== 'object') return undefined;
  if (!Array.isArray(stepsJson) && 'roleUserMap' in stepsJson) {
    return (stepsJson as Record<string, unknown>).roleUserMap as Record<string, string> | undefined;
  }
  return undefined;
}

async function main() {
  console.log('=== 批量修复 assignee 漂移 ===');
  console.log('');

  const requirements = await prisma.requirement.findMany({
    where: {
      workflowId: { not: null },
      currentStep: {
        not: null,
        notIn: ['done', 'abandoned'],
      },
    },
    select: {
      id: true,
      title: true,
      currentStep: true,
      assigneeId: true,
      requesterId: true,
      workflowId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`共 ${requirements.length} 个活跃需求`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const req of requirements) {
    try {
      const template = await prisma.workflowTemplate.findUnique({
        where: { id: req.workflowId! },
        select: { name: true, displayName: true, steps: true },
      });
      if (!template) {
        console.log(`  ⏭ [${req.id.slice(0, 8)}] 模板不存在，跳过`);
        skipped++;
        continue;
      }

      const steps = (template.steps as unknown);
      // 兼容新格式：{ steps: [...], roleUserMap: {...} }
      const stepsArray: any[] = Array.isArray(steps) ? steps : ((steps as any).steps ?? []);
      const stepDef = stepsArray.find((s: any) => s.name === req.currentStep);
      if (!stepDef) {
        console.log(`  ⏭ [${req.id.slice(0, 8)}] 步骤「${req.currentStep}」在模板中不存在，跳过`);
        skipped++;
        continue;
      }

      const roleUserMap = !Array.isArray(steps) ? extractRoleUserMap(template.steps) : undefined;

      // 计算正确的 assignee
      let correctAssigneeId: string | null = null;

      if (stepDef.role === 'requester' || (stepDef.assigneeMode === 'creator') || req.currentStep === 'draft') {
        // draft/requester 步骤：assignee = requesterId
        correctAssigneeId = req.requesterId;
      } else if (stepDef.assigneeMode === 'fixed') {
        // fixed 模式：保持不变
        correctAssigneeId = req.assigneeId;
      } else if (roleUserMap && roleUserMap[stepDef.role]) {
        // role-based 有 map：查表
        correctAssigneeId = roleUserMap[stepDef.role];
      } else {
        // role-based 无 map：用旧逻辑匹配 internalRole
        const WORKFLOW_ROLE_TO_INTERNAL: Record<string, string> = {
          backend_developer: 'backend_developer',
          frontend_developer: 'frontend_developer',
          mobile_developer: 'mobile_developer',
          miniapp_developer: 'miniapp_developer',
          game_developer: 'game_developer',
          tester: 'tester',
          security: 'security',
          cto: 'cto',
          admin: 'cto',
          ops: 'ops',
          pm: 'pm',
          qa: 'qa',
          architect: 'architect',
        };
        const internalRole = WORKFLOW_ROLE_TO_INTERNAL[stepDef.role];
        if (internalRole) {
          const user = await prisma.user.findFirst({
            where: { internalRole: internalRole as any },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true },
          });
          if (user) correctAssigneeId = user.id;
        }
      }

      if (correctAssigneeId === null || correctAssigneeId === req.assigneeId) {
        skipped++;
        continue;
      }

      // 执行修复
      await prisma.requirement.update({
        where: { id: req.id },
        data: { assigneeId: correctAssigneeId },
      });

      const oldName = await prisma.user.findUnique({ where: { id: req.assigneeId ?? '' }, select: { name: true } });
      const newName = await prisma.user.findUnique({ where: { id: correctAssigneeId }, select: { name: true } });

      console.log(
        `  ✅ [${req.id.slice(0, 8)}] ${req.title?.slice(0, 40)}`
        + ` 步骤=${req.currentStep}`
        + ` assignee: ${oldName?.name ?? req.assigneeId?.slice(0, 8) ?? '(无)'}`
        + ` → ${newName?.name ?? correctAssigneeId?.slice(0, 8)}`,
      );
      fixed++;
    } catch (err) {
      console.error(`  ❌ [${req.id.slice(0, 8)}] 错误:`, err);
      errors++;
    }
  }

  console.log('');
  console.log('=== 修复完成 ===');
  console.log(`总需求: ${requirements.length}`);
  console.log(`已修复: ${fixed}`);
  console.log(`已跳过: ${skipped}`);
  console.log(`错误数: ${errors}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
