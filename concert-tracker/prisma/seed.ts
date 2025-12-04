import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Running database seed...')

  // Check if any admin user exists
  const adminCount = await prisma.user.count({
    where: {
      role: 'ADMIN'
    }
  })

  if (adminCount === 0) {
    console.log('📝 No admin user found. Creating default admin...')

    const hashedPassword = await bcrypt.hash('admin', 10)
    const now = Math.floor(Date.now() / 1000)

    await prisma.user.create({
      data: {
        username: 'admin',
        hashedPassword,
        role: 'ADMIN',
        createdAt: now,
        updatedAt: now
      }
    })

    console.log('✅ Default admin user created:')
    console.log('   Username: admin')
    console.log('   Password: admin')
    console.log('   ⚠️  IMPORTANT: Change this password immediately in production!')
  } else {
    console.log(`✅ Admin user(s) already exist (${adminCount} found). Skipping creation.`)
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
