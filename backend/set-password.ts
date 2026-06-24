import { prisma } from './src/lib/prisma.js';
import bcrypt from 'bcrypt';

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'ceo-agent@example.com' } });
  if (!user) {
    console.log('User not found');
    await prisma.$disconnect();
    return;
  }

  console.log('User:', user.id, user.name, user.email);
  console.log('Password hash:', user.passwordHash ? 'exists' : 'none');

  // 设置测试密码
  const passwordHash = await bcrypt.hash('test123', 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
  console.log('Set password to: test123');

  await prisma.$disconnect();
}

main().catch(console.error);
