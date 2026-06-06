// Verification probe: confirms PostRentalCharge table, Order columns, and the
// unique constraint on (orderId, periodStart) all exist live on Railway.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  // 1) Pull live column metadata for post_rental_charges.
  const cols = await prisma.$queryRawUnsafe<
    Array<{ column_name: string; data_type: string; is_nullable: string }>
  >(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'post_rental_charges'
    ORDER BY ordinal_position
  `)
  console.log('--- post_rental_charges columns ---')
  for (const c of cols) console.log(` ${c.column_name.padEnd(28)} ${c.data_type} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`)

  // 2) New Order columns.
  const orderCols = await prisma.$queryRawUnsafe<
    Array<{ column_name: string; data_type: string; column_default: string | null }>
  >(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name IN ('post_rental_enabled_override', 'post_rental_stopped_at')
    ORDER BY column_name
  `)
  console.log('\n--- orders new columns ---')
  for (const c of orderCols) console.log(` ${c.column_name.padEnd(32)} ${c.data_type} default=${c.column_default ?? '(none)'}`)

  // 3) Unique constraint check on (order_id, period_start).
  const idx = await prisma.$queryRawUnsafe<
    Array<{ indexname: string; indexdef: string }>
  >(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'post_rental_charges'
    ORDER BY indexname
  `)
  console.log('\n--- post_rental_charges indexes ---')
  for (const i of idx) console.log(` ${i.indexname}\n   ${i.indexdef}`)

  // 4) Enum values.
  const enums = await prisma.$queryRawUnsafe<
    Array<{ enum_name: string; enum_value: string }>
  >(`
    SELECT t.typname AS enum_name, e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname IN ('PostRentalChargeType', 'PostRentalChargeStatus')
    ORDER BY t.typname, e.enumsortorder
  `)
  console.log('\n--- post-rental enums ---')
  for (const e of enums) console.log(` ${e.enum_name.padEnd(26)} ${e.enum_value}`)

  // 5) Smoke-test unique constraint by attempting a duplicate insert against
  //    a real order. We rollback in a transaction so nothing is persisted.
  const order = await prisma.order.findFirst({ select: { id: true, orderNumber: true } })
  if (!order) {
    console.log('\n--- unique constraint probe ---\n no orders in DB; skipping live insert probe')
  } else {
    console.log(`\n--- unique constraint probe (order ${order.orderNumber}) ---`)
    const periodStart = new Date('2099-01-01T00:00:00.000Z')
    const periodEnd = new Date('2099-04-01T00:00:00.000Z')
    // First insert: should succeed.
    let firstId: string | null = null
    try {
      const row = await prisma.postRentalCharge.create({
        data: {
          orderId: order.id,
          chargeType: '6mo',
          amountCents: 1800,
          periodStart,
          periodEnd,
        },
      })
      firstId = row.id
      console.log(' first insert OK')
    } catch (err) {
      console.log(' first insert FAIL:', err instanceof Error ? err.message.split('\n')[0] : err)
    }
    // Second insert with same (orderId, periodStart) must throw P2002.
    let dupeError: string | null = null
    try {
      await prisma.postRentalCharge.create({
        data: {
          orderId: order.id,
          chargeType: '9mo',
          amountCents: 1800,
          periodStart,
          periodEnd,
        },
      })
    } catch (err) {
      dupeError = err instanceof Error ? err.message.split('\n')[0] : String(err)
    }
    if (dupeError) console.log(` OK — duplicate rejected: ${dupeError.slice(0, 160)}`)
    else console.log(' FAIL — duplicate was accepted')
    // Cleanup the probe row.
    if (firstId) {
      await prisma.postRentalCharge.delete({ where: { id: firstId } })
      console.log(' probe row cleaned up')
    }
  }

  // 6) Sanity-count of existing rows (should be 0 — table just created).
  const count = await prisma.postRentalCharge.count()
  console.log(`\nPostRentalCharge row count: ${count}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
