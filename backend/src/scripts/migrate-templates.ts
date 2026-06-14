#!/usr/bin/env node
/**
 * migrate-templates.ts — 旧模板清理迁移脚本
 *
 * 功能：
 * 1. 标记所有 legacy_ 前缀模板为 isActive=false
 * 2. 将绑定到非活跃模板的活跃需求迁移到同角色/同类型的新模板
 * 3. dry-run 模式预览变更
 *
 * 用法：
 *   npx tsx src/scripts/migrate-templates.ts          # dry-run（默认）
 *   npx tsx src/scripts/migrate-templates.ts --apply   # 实际执行
 *
 * 2026-06-14
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 旧模板名 → 目标新模板映射
const LEGACY_TO_TARGET: Record<string, string> = {
  'standard-dev': 'backend-dev',
  'fullstack-dev': 'backend-dev',
};

async function main() {
  const isDryRun = !process.argv.includes('--apply');
  console.log(`\n🔍 旧模板清理迁移脚本 (${isDryRun ? 'DRY-RUN 模式' : '实际执行'})\n`);

  // 1. 查找所有 legacy_ 模板和已停用的模板
  const allTemplates = await prisma.workflowTemplate.findMany();
  const legacyTemplates = allTemplates.filter(t =>
    t.name.startsWith('legacy_') || LEGACY_TO_TARGET[t.name] !== undefined
  );
  const activeTemplates = allTemplates.filter(t => t.isActive);

  console.log(`   共 ${allTemplates.length} 个模板，其中活跃 ${activeTemplates.length} 个`);
  console.log(`   待清理模板 ${legacyTemplates.length} 个:\n`);

  for (const tmpl of legacyTemplates) {
    const targetName = tmpl.name.startsWith('legacy_')
      ? '（legacy_ 前缀，需手动指定目标模板）'
      : `→ ${LEGACY_TO_TARGET[tmpl.name]}`;
    console.log(`   📦 ${tmpl.name} (${tmpl.displayName}) — ${targetName}`);
  }

  // 2. 查找绑定到非活跃模板的活跃需求
  const legacyIds = legacyTemplates.map(t => t.id);
  const orphanReqs = await prisma.requirement.findMany({
    where: {
      workflowId: { in: legacyIds },
      status: { notIn: ['done', 'rejected', 'abandoned'] },
    },
    select: { id: true, title: true, workflowId: true, currentStep: true },
  });

  console.log(`\n   绑定到非活跃模板的活跃需求: ${orphanReqs.length} 条\n`);
  for (const req of orphanReqs) {
    const currentTemplate = legacyTemplates.find(t => t.id === req.workflowId);
    const targetName = currentTemplate
      ? (LEGACY_TO_TARGET[currentTemplate.name] ?? '未知')
      : '未知';
    console.log(`   📋 ${req.id.slice(0, 8)}... | ${req.title.slice(0, 40)} | ${currentTemplate?.name ?? '?'} → ${targetName}`);
  }

  // 3. 查找所有 legacy_ 前缀模板（即使不在上述映射中）
  const allLegacyPrefixed = allTemplates.filter(t => t.name.startsWith('legacy_'));
  for (const tmpl of allLegacyPrefixed) {
    if (!legacyTemplates.find(t => t.id === tmpl.id)) {
      console.log(`\n   ⚠️ 额外 legacy_ 前缀模板: ${tmpl.name} (${tmpl.id.slice(0, 8)}...)`);
      const boundReqs = await prisma.requirement.count({
        where: { workflowId: tmpl.id, status: { notIn: ['done', 'rejected', 'abandoned'] } },
      });
      if (boundReqs > 0) {
        console.log(`      ⚠️ 有 ${boundReqs} 条活跃需求绑定，需手动指定迁移目标`);
      }
    }
  }

  if (isDryRun) {
    console.log(`\n✅ Dry-run 完成，未做任何修改。使用 --apply 执行迁移。\n`);
    return;
  }

  // 实际执行
  console.log(`\n⚡ 开始执行迁移...\n`);

  // Step A: 停用旧模板
  const deactivated: string[] = [];
  for (const tmpl of legacyTemplates) {
    await prisma.workflowTemplate.update({
      where: { id: tmpl.id },
      data: { isActive: false },
    });
    deactivated.push(tmpl.name);
    console.log(`   ✅ 已停用模板: ${tmpl.name}`);
  }

  // Step B: 迁移活跃需求
  let migrated = 0;
  for (const req of orphanReqs) {
    const currentTemplate = legacyTemplates.find(t => t.id === req.workflowId);
    if (!currentTemplate) continue;

    const targetName = LEGACY_TO_TARGET[currentTemplate.name];
    if (!targetName) {
      console.log(`   ⚠️ 跳过需求 ${req.id.slice(0, 8)}... — 找不到 ${currentTemplate.name} 的目标模板`);
      continue;
    }

    const targetTemplate = activeTemplates.find(t => t.name === targetName);
    if (!targetTemplate) {
      console.log(`   ⚠️ 跳过需求 ${req.id.slice(0, 8)}... — 目标模板 ${targetName} 不存在或已停用`);
      continue;
    }

    // 检查目标模板是否有对应的步骤
    const targetSteps = (targetTemplate.steps as any[]) || [];
    const currentStepExists = targetSteps.some((s: any) => s.name === req.currentStep);
    if (!currentStepExists) {
      console.log(`   ⚠️ 跳过需求 ${req.id.slice(0, 8)}... — 当前步骤 ${req.currentStep} 在目标模板中不存在`);
      continue;
    }

    await prisma.requirement.update({
      where: { id: req.id },
      data: { workflowId: targetTemplate.id },
    });
    migrated++;
    console.log(`   ✅ 已迁移需求 ${req.id.slice(0, 8)}...: ${currentTemplate.name} → ${targetName}`);
  }

  console.log(`\n📊 迁移统计:`);
  console.log(`   停用模板: ${deactivated.length} 个`);
  console.log(`   迁移需求: ${migrated} 条`);
  console.log(`   跳过需求: ${orphanReqs.length - migrated} 条（步骤不匹配或无目标模板）`);
  console.log(`\n✅ 迁移完成！\n`);
}

main()
  .catch((e) => {
    console.error('❌ 迁移失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
