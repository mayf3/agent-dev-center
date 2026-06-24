import { prisma } from './src/lib/prisma.js';

async function main() {
  const count = await prisma.workflowTransition.count();
  console.log('workflow_transitions count:', count);
  if (count > 0) {
    const sample = await prisma.workflowTransition.findFirst();
    console.log('sample:', JSON.stringify(sample, null, 2));
  }
  await prisma.$disconnect();
}

main().catch(console.error);
