// Raw-SQL probe to confirm the unique constraint actually rejects duplicates.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const order = await prisma.order.findFirst({ select: { id: true, orderNumber: true } })
  if (!order) { console.log('no order in DB'); return }
  const orderId = order.id

  // Pre-clean.
  await prisma.$executeRawUnsafe(
    `DELETE FROM post_rental_charges WHERE order_id = $1 AND period_start = '2099-01-01T00:00:00.000Z'`,
    orderId,
  )

  // First insert via raw SQL.
  await prisma.$executeRawUnsafe(
    `INSERT INTO post_rental_charges
       (id, order_id, "chargeType", amount_cents, period_start, period_end, status, attempt_count, created_at, updated_at)
     VALUES ($1, $2, '6mo', 1800, '2099-01-01T00:00:00.000Z', '2099-04-01T00:00:00.000Z', 'scheduled', 0, NOW(), NOW())`,
    'probe_first_' + Date.now(),
    orderId,
  )
  console.log('first raw insert OK')

  // Show what's in the table for this order.
  const rowsAfterFirst = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, order_id, period_start, "chargeType" FROM post_rental_charges WHERE order_id = $1`,
    orderId,
  )
  console.log('rows after first insert:', rowsAfterFirst)

  // Second insert with same (order_id, period_start) must throw.
  let dupeError: string | null = null
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO post_rental_charges
         (id, order_id, "chargeType", amount_cents, period_start, period_end, status, attempt_count, created_at, updated_at)
       VALUES ($1, $2, '9mo', 1800, '2099-01-01T00:00:00.000Z', '2099-04-01T00:00:00.000Z', 'scheduled', 0, NOW(), NOW())`,
      'probe_dupe_' + Date.now(),
      orderId,
    )
  } catch (err) {
    dupeError = err instanceof Error ? err.message.split('\n')[0] : String(err)
  }
  if (dupeError) console.log(`OK — raw duplicate rejected: ${dupeError.slice(0, 200)}`)
  else console.log('FAIL — raw duplicate was accepted')

  const rowsAfterDupe = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, order_id, period_start, "chargeType" FROM post_rental_charges WHERE order_id = $1`,
    orderId,
  )
  console.log('rows after duplicate attempt:', rowsAfterDupe)

  // Cleanup.
  await prisma.$executeRawUnsafe(
    `DELETE FROM post_rental_charges WHERE order_id = $1 AND period_start = '2099-01-01T00:00:00.000Z'`,
    orderId,
  )
  console.log('cleanup done')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
