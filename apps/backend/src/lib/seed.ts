import { prisma } from './prisma';

async function seed() {
  console.log('Seeding database...');

  // Seed default credit cost
  await prisma.platform_settings.upsert({
    where: { key: 'ai_default_credit_cost' },
    update: {},
    create: {
      key: 'ai_default_credit_cost',
      value: '0.30',
    },
  });

  console.log('Seeding completed.');
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
