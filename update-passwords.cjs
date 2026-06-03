const bcrypt = require('bcrypt');
const { PrismaClient } = require('.prisma/client');
const fs = require('fs');
const passwords = JSON.parse(fs.readFileSync('/tmp/adc_passwords.json', 'utf8'));

async function main() {
  const prisma = new PrismaClient();
  
  for (const acc of passwords) {
    const hash = await bcrypt.hash(acc.password, 10);
    const result = await prisma.user.updateMany({
      where: { email: acc.email },
      data: { password: hash }
    });
    if (result.count > 0) {
      console.log(`✅ ${acc.email}`);
    } else {
      console.log(`⚠️  ${acc.email} not found`);
    }
  }
  
  await prisma.$disconnect();
}

main();
