import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding marketplace_agents from users...');
  
  const users = await prisma.user.findMany({
    where: {
      internalRole: { not: null },
      marketplaceAgents: { none: {} },  // 还没同步到 marketplace 的
    },
  });

  const agents = await Promise.all(
    users.map((user) =>
      prisma.marketplaceAgent.upsert({
        where: { name: user.name },
        update: {
          displayName: user.name,
          description: `Agent: ${user.name}`,
          status: 'active',
          userId: user.id,
        },
        create: {
          name: user.name,
          displayName: user.name,
          description: `Agent: ${user.name}`,
          status: 'active',
          userId: user.id,
        },
      })
    )
  );

  console.log(`Created/updated ${agents.length} marketplace agents`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
