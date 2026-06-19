import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://postgres:postgres@8.163.44.127:5432/agent_dev_center?schema=public&connect_timeout=10',
      },
    },
  });

  const NEW_STEP = { name: 'test_env_deploy', displayName: '部署测试环境', role: 'ops', requiredReports: [], autoAdvance: false };

  const templates = await prisma.workflowTemplate.findMany();
  for (const tmpl of templates) {
    const steps = tmpl.steps;
    if (!Array.isArray(steps)) continue;
    const names = steps.map((s: any) => s.name);
    const dscIdx = names.indexOf('dev_self_check');
    const testIdx = names.indexOf('testing');
    if (dscIdx >= 0 && testIdx >= 0 && testIdx === dscIdx + 1) {
      const newSteps = [...steps];
      newSteps.splice(testIdx, 0, NEW_STEP);
      await prisma.workflowTemplate.update({ where: { id: tmpl.id }, data: { steps: newSteps } });
      console.log('✅ ' + tmpl.name + ': added test_env_deploy');
    } else {
      console.log('⏭ ' + tmpl.name + ': skipped (' + names.join(' → ') + ')');
    }
  }
  console.log('Done!');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
