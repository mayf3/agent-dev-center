// Test Prisma requirement.update with query logging
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  log: [
    { emit: 'stdout', level: 'query' },
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
  ],
});

async function main() {
  console.log('=== Step 1: findFirst ===');
  try {
    const req = await prisma.requirement.findFirst({
      where: { id: 'df1e4527-ddd3-4004-87d8-3aaa0465fb73' },
      select: { id: true, title: true, currentStep: true, status: true }
    });
    console.log('Found:', JSON.stringify(req));
  } catch(e) {
    console.error('FindFirst error:', e.message);
    if (e.meta) console.error('Meta:', JSON.stringify(e.meta));
  }

  console.log('\n=== Step 2: simple update ===');
  try {
    const updated = await prisma.requirement.update({
      where: { id: 'df1e4527-ddd3-4004-87d8-3aaa0465fb73' },
      data: { rejectReason: null },
    });
    console.log('Updated OK');
  } catch(e) {
    console.error('Update error:', e.message);
    if (e.meta) console.error('Meta:', JSON.stringify(e.meta));
    console.error('Code:', e.code);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
