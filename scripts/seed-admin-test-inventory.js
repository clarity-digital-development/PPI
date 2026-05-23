/**
 * Seed test inventory for admin@pinkposts.com so they can end-to-end test
 * the cart / batch order flow without manually adding inventory via the
 * customer detail page.
 *
 * Idempotent: safe to re-run; won't duplicate items if you run it twice
 * (it counts existing in-storage items first and only creates the deficit).
 *
 * Usage: node scripts/seed-admin-test-inventory.js
 */

const { Pool } = require('pg')
const { PrismaPg } = require('@prisma/adapter-pg')
const { PrismaClient } = require('@prisma/client')
require('dotenv').config({ path: '.env.local' })

const ADMIN_EMAIL = 'admin@pinkposts.com'

// Target counts of each item type to have in storage
const TARGETS = {
  signs: [
    { description: 'For Sale Sign — Test', count: 5 },
    { description: 'Coming Soon Sign — Test', count: 2 },
    { description: 'Open House Sign — Test', count: 1 },
  ],
  riders: [
    { name: 'FOR SALE', count: 5 },
    { name: 'COMING SOON', count: 3 },
    { name: 'SOLD', count: 2 },
    { name: 'PENDING', count: 2 },
  ],
  lockboxes: [
    { typeName: 'SentriLock', code: 'TEST-001', count: 1 },
    { typeName: 'SentriLock', code: 'TEST-002', count: 1 },
    { typeName: 'Mechanical (Customer Owned)', code: '4321', count: 1 },
  ],
  brochureBoxes: 3,
  otherItems: [
    { description: 'White Metal Frame (test)' },
    { description: 'Bracket — test item' },
  ],
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  const admin = await prisma.user.findFirst({
    where: { email: ADMIN_EMAIL },
    select: { id: true, email: true, fullName: true, role: true, stripeCustomerId: true },
  })

  if (!admin) {
    console.error(`No user found with email ${ADMIN_EMAIL}`)
    process.exit(1)
  }

  console.log(`Seeding inventory for ${admin.email} (${admin.id})`)
  console.log('---')

  // ===== Signs =====
  let signsCreated = 0
  for (const target of TARGETS.signs) {
    const existing = await prisma.customerSign.count({
      where: { userId: admin.id, description: target.description, inStorage: true },
    })
    const toCreate = Math.max(0, target.count - existing)
    if (toCreate > 0) {
      await prisma.customerSign.createMany({
        data: Array.from({ length: toCreate }, () => ({
          userId: admin.id,
          description: target.description,
          inStorage: true,
        })),
      })
      signsCreated += toCreate
    }
    console.log(`  ✓ ${target.description}: ${existing + toCreate} in storage (added ${toCreate})`)
  }

  // ===== Riders =====
  let ridersCreated = 0
  for (const target of TARGETS.riders) {
    const rider = await prisma.riderCatalog.findFirst({ where: { name: target.name } })
    if (!rider) {
      console.warn(`  ✗ Rider "${target.name}" not in catalog — skipping`)
      continue
    }
    const existing = await prisma.customerRider.count({
      where: { userId: admin.id, riderId: rider.id, inStorage: true },
    })
    const toCreate = Math.max(0, target.count - existing)
    if (toCreate > 0) {
      await prisma.customerRider.createMany({
        data: Array.from({ length: toCreate }, () => ({
          userId: admin.id,
          riderId: rider.id,
          isOwned: true,
          inStorage: true,
        })),
      })
      ridersCreated += toCreate
    }
    console.log(`  ✓ ${target.name} rider: ${existing + toCreate} in storage (added ${toCreate})`)
  }

  // ===== Lockboxes =====
  let lockboxesCreated = 0
  for (const target of TARGETS.lockboxes) {
    const lbType = await prisma.lockboxType.findFirst({ where: { name: target.typeName } })
    if (!lbType) {
      console.warn(`  ✗ Lockbox type "${target.typeName}" not in catalog — skipping`)
      continue
    }
    const existing = await prisma.customerLockbox.count({
      where: { userId: admin.id, lockboxTypeId: lbType.id, code: target.code, inStorage: true },
    })
    const toCreate = Math.max(0, target.count - existing)
    if (toCreate > 0) {
      await prisma.customerLockbox.createMany({
        data: Array.from({ length: toCreate }, () => ({
          userId: admin.id,
          lockboxTypeId: lbType.id,
          code: target.code,
          isOwned: true,
          inStorage: true,
        })),
      })
      lockboxesCreated += toCreate
    }
    console.log(`  ✓ ${target.typeName} ${target.code}: ${existing + toCreate} in storage (added ${toCreate})`)
  }

  // ===== Brochure Boxes =====
  const existingBoxes = await prisma.customerBrochureBox.count({
    where: { userId: admin.id, inStorage: true },
  })
  const boxesToCreate = Math.max(0, TARGETS.brochureBoxes - existingBoxes)
  if (boxesToCreate > 0) {
    await prisma.customerBrochureBox.createMany({
      data: Array.from({ length: boxesToCreate }, () => ({
        userId: admin.id,
        description: 'Test brochure box',
        inStorage: true,
      })),
    })
  }
  console.log(`  ✓ Brochure boxes: ${existingBoxes + boxesToCreate} in storage (added ${boxesToCreate})`)

  // ===== Other Items =====
  let othersCreated = 0
  for (const target of TARGETS.otherItems) {
    const existing = await prisma.customerOtherItem.count({
      where: { userId: admin.id, description: target.description },
    })
    if (existing === 0) {
      await prisma.customerOtherItem.create({
        data: { userId: admin.id, description: target.description },
      })
      othersCreated++
    }
  }
  console.log(`  ✓ Other items: ${TARGETS.otherItems.length} total (added ${othersCreated})`)

  console.log('---')
  console.log(
    `Summary: +${signsCreated} signs, +${ridersCreated} riders, +${lockboxesCreated} lockboxes, +${boxesToCreate} brochure boxes, +${othersCreated} other items`
  )
  console.log('')
  console.log('Payment method: must be added via the UI (Stripe Elements). Go to:')
  console.log('  /dashboard/billing → Add Card')
  console.log('')
  console.log('Then test the cart:')
  console.log('  1. /dashboard/place-order')
  console.log('  2. Fill out wizard, on Review type an Agent Name, click "Add to Cart"')
  console.log('  3. Repeat for a 2nd order')
  console.log('  4. Click the cart icon in the header → Place orders')

  await prisma.$disconnect()
  pool.end()
}

main().catch(err => {
  console.error('ERR:', err.message)
  process.exit(1)
})
