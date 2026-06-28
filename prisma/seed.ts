import { config } from 'dotenv'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Only load from .env files if DATABASE_URL is not already set (production)
if (!process.env.DATABASE_URL) {
  config({ path: '.env.local' })
  config({ path: '.env' })
}

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set')

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set!')
  console.error('For Railway: Make sure DATABASE_URL environment variable is configured')
  console.error('For local: Create a .env.local file with DATABASE_URL')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding database...')

  // Create Post Types
  const postTypes = await Promise.all([
    prisma.postType.upsert({
      where: { name: 'White Vinyl Post' },
      update: {},
      create: {
        name: 'White Vinyl Post',
        description: 'Classic white vinyl post with professional installation and pickup',
        price: 59.00,
        imageUrl: '/images/posts/white-post.jpg',
        isActive: true,
      },
    }),
    prisma.postType.upsert({
      where: { name: 'Black Vinyl Post' },
      update: {},
      create: {
        name: 'Black Vinyl Post',
        description: 'Sleek black vinyl post with professional installation and pickup',
        price: 59.00,
        imageUrl: '/images/posts/black-post.jpg',
        isActive: true,
      },
    }),
    prisma.postType.upsert({
      where: { name: 'Signature Pink Post' },
      update: {},
      create: {
        name: 'Signature Pink Post',
        description: 'Our signature pink vinyl post - stand out from the crowd!',
        price: 65.00,
        imageUrl: '/images/posts/pink-post.jpg',
        isActive: true,
      },
    }),
    prisma.postType.upsert({
      where: { name: 'Metal Frame Sign' },
      update: {},
      create: {
        name: 'Metal Frame Sign',
        description: 'Standard angle iron frame, powder coated finish, fits 18"h x 24"w signs',
        price: 40.00,
        imageUrl: '/images/posts/metal-frame.jpg',
        isActive: true,
      },
    }),
  ])
  console.log(`Created ${postTypes.length} post types`)

  // Create Rider Catalog
  const riderNames = [
    'COMING SOON',
    'FOR SALE',
    'NEW LISTING',
    'OPEN HOUSE',
    'UNDER CONTRACT',
    'PENDING',
    'SOLD',
    'REDUCED',
    'NEW PRICE',
    'PRICE IMPROVED',
    'MOVE-IN READY',
    'MUST SEE',
    'MOTIVATED SELLER',
    'AGENT ON SITE',
    'BY APPOINTMENT',
    'CALL FOR DETAILS',
    'HOME WARRANTY',
    'POOL',
    'ACREAGE',
    'NEW CONSTRUCTION',
    'JUST LISTED',
    'VIRTUAL TOUR',
    'VIDEO TOUR',
    'WATERFRONT',
    'GOLF COURSE',
    'CUSTOM',
  ]

  const riders = await Promise.all(
    riderNames.map((name) =>
      prisma.riderCatalog.upsert({
        where: { name },
        update: {},
        create: {
          name,
          description: `${name} rider`,
          rentalPrice: 5.00,
          isActive: true,
        },
      })
    )
  )
  console.log(`Created ${riders.length} rider types`)

  // Create Lockbox Types
  const lockboxTypes = await Promise.all([
    prisma.lockboxType.upsert({
      where: { name: 'Sentrilock/Supra' },
      update: {},
      create: {
        name: 'Sentrilock/Supra',
        description: 'Electronic Sentrilock/Supra - customer owned',
        rentalPrice: null,
        installFee: 5.00,
        isRentable: false,
        isActive: true,
      },
    }),
    prisma.lockboxType.upsert({
      where: { name: 'Mechanical (Customer Owned)' },
      update: {},
      create: {
        name: 'Mechanical (Customer Owned)',
        description: 'Standard mechanical lockbox - customer owned',
        rentalPrice: null,
        installFee: 5.00,
        isRentable: false,
        isActive: true,
      },
    }),
    prisma.lockboxType.upsert({
      where: { name: 'Mechanical (Rental)' },
      update: {},
      create: {
        name: 'Mechanical (Rental)',
        description: 'Standard mechanical lockbox rental',
        rentalPrice: 10.00,
        installFee: 5.00,
        isRentable: true,
        isActive: true,
      },
    }),
  ])
  console.log(`Created ${lockboxTypes.length} lockbox types`)

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 12)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@pinkposts.com' },
    update: {
      password: hashedPassword, // Always update password on seed
      role: 'admin',
    },
    create: {
      email: 'admin@pinkposts.com',
      password: hashedPassword,
      name: 'Admin User',
      fullName: 'Admin User',
      role: 'admin',
    },
  })
  console.log(`Created admin user: ${adminUser.email}`)

  console.log('Seeding complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
