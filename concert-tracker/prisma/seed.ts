import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Country code to name mapping (common countries)
const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  'tr': 'Turkey',
  'fr': 'France',
  'de': 'Germany',
  'us': 'United States',
  'gb': 'United Kingdom',
  'es': 'Spain',
  'it': 'Italy',
  'nl': 'Netherlands',
  'be': 'Belgium',
  'ch': 'Switzerland',
  'at': 'Austria',
  'pl': 'Poland',
  'cz': 'Czech Republic',
  'se': 'Sweden',
  'no': 'Norway',
  'dk': 'Denmark',
  'fi': 'Finland',
  'pt': 'Portugal',
  'gr': 'Greece',
  'hu': 'Hungary',
  'ro': 'Romania',
  'bg': 'Bulgaria',
  'hr': 'Croatia',
  'rs': 'Serbia',
  'si': 'Slovenia',
  'sk': 'Slovakia',
  'ie': 'Ireland',
  'lu': 'Luxembourg',
  'ca': 'Canada',
  'mx': 'Mexico',
  'br': 'Brazil',
  'ar': 'Argentina',
  'cl': 'Chile',
  'au': 'Australia',
  'nz': 'New Zealand',
  'jp': 'Japan',
  'kr': 'South Korea',
  'cn': 'China',
  'in': 'India',
  'ru': 'Russia',
  'ua': 'Ukraine',
  'il': 'Israel',
  'za': 'South Africa',
  'ge': 'Georgia',
}

async function main() {
  console.log('🌱 Running database seed...')

  // 1. Seed default admin user
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

  // 2. Seed countries from COUNTRY_CODES env var
  const countryCount = await prisma.country.count()

  if (countryCount === 0) {
    console.log('📝 No countries found. Seeding from COUNTRY_CODES...')

    // Get country codes from env var (comma-separated or JSON array)
    const countryCodes = process.env.COUNTRY_CODES || 'tr,fr,de'
    let codes: string[] = []

    try {
      // Try parsing as JSON array first
      codes = JSON.parse(countryCodes)
    } catch {
      // Fall back to comma-separated
      codes = countryCodes.split(',').map(c => c.trim().toLowerCase())
    }

    const now = Math.floor(Date.now() / 1000)
    let created = 0

    for (const code of codes) {
      const countryName = COUNTRY_CODE_TO_NAME[code] || code.toUpperCase()

      try {
        await prisma.country.create({
          data: {
            name: countryName,
            code: code.toLowerCase(),
            active: true,
            createdAt: now,
            updatedAt: now
          }
        })
        created++
        console.log(`   ✓ Added ${countryName} (${code})`)
      } catch (error: any) {
        // Skip if country already exists (shouldn't happen, but defensive)
        if (error.code === 'P2002') {
          console.log(`   ⊘ ${countryName} (${code}) already exists`)
        } else {
          console.error(`   ✗ Failed to add ${code}: ${error.message}`)
        }
      }
    }

    console.log(`✅ Created ${created} countries from COUNTRY_CODES`)
  } else {
    console.log(`✅ Countries already exist (${countryCount} found). Skipping creation.`)
  }

  // 3. Seed global settings from env vars (if defined and not already in DB)
  console.log('\n📝 Checking global settings...')
  const now = Math.floor(Date.now() / 1000)

  const settingsToSeed = [
    { key: 'LASTFM_API_KEY', envVar: process.env.LASTFM_API_KEY, valueType: 'string', description: 'Last.fm API key for fetching artist data' },
    { key: 'FANART_API_KEY', envVar: process.env.FANART_API_KEY, valueType: 'string', description: 'Fanart.tv API key for fetching artist images' },
    { key: 'WEBSHARE_PROXY_URL', envVar: process.env.WEBSHARE_PROXY_URL, valueType: 'string', description: 'Webshare.io proxy download URL' },
  ]

  let seededSettings = 0

  for (const { key, envVar, valueType, description } of settingsToSeed) {
    // Only seed if env var is defined and not empty
    if (!envVar || envVar.trim() === '') {
      console.log(`   ⊘ ${key}: Not set in environment, skipping`)
      continue
    }

    // Check if setting already exists in DB
    const existing = await prisma.setting.findUnique({ where: { key } })

    if (!existing || existing.value === '' || existing.value === null) {
      // Create or update setting with env value
      await prisma.setting.upsert({
        where: { key },
        update: { value: envVar, valueType, updatedAt: now },
        create: { key, value: envVar, valueType, description, createdAt: now, updatedAt: now }
      })
      seededSettings++
      console.log(`   ✓ ${key}: Seeded from environment`)
    } else {
      console.log(`   ⊘ ${key}: Already set in database (value: ${existing.value.substring(0, 10)}...)`)
    }
  }

  if (seededSettings > 0) {
    console.log(`✅ Seeded ${seededSettings} global settings from environment variables`)
  } else {
    console.log(`✅ All global settings already configured or not set in environment`)
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
