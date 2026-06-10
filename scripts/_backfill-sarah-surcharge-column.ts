/**
 * One-shot data correction. Sarah's order PPI-MQ8A98MT-60XL fired the
 * out-of-area surcharge via the synthetic OrderItem path, but the
 * column-persistence bug fixed in round 17 (commit 46d28e6) meant
 * Order.serviceAreaSurchargeCents stayed at 0 and Order.serviceAreaCenterId
 * stayed null. Future orders persist correctly; this script backfills the
 * historical row so reporting numbers are accurate.
 *
 * No money changes hands. Display + audit data only.
 *
 * Usage:
 *   npx tsx scripts/_backfill-sarah-surcharge-column.ts              # dry-run
 *   npx tsx scripts/_backfill-sarah-surcharge-column.ts --apply      # writes
 */
import { readFileSync } from 'fs'
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

const APPLY = process.argv.includes('--apply')
const ORDER_NUMBER = 'PPI-MQ8A98MT-60XL'

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { audit, AuditAction } = await import('../lib/audit')

  const order = await prisma.order.findUnique({
    where: { orderNumber: ORDER_NUMBER },
    select: {
      id: true,
      orderNumber: true,
      propertyZip: true,
      total: true,
      subtotal: true,
      serviceAreaSurchargeCents: true,
      serviceAreaCenterId: true,
      orderItems: { where: { itemType: 'surcharge' }, select: { description: true, totalPrice: true } },
      user: { select: { email: true } },
    },
  })

  if (!order) {
    console.log(`Order ${ORDER_NUMBER} not found`)
    return
  }

  console.log(`Found order ${order.orderNumber} (${order.user.email})`)
  console.log(`  zip                       : ${order.propertyZip}`)
  console.log(`  total                     : $${order.total}`)
  console.log(`  subtotal                  : $${order.subtotal}`)
  console.log(`  serviceAreaSurchargeCents : ${order.serviceAreaSurchargeCents} (should be 5000)`)
  console.log(`  serviceAreaCenterId       : ${order.serviceAreaCenterId ?? '(null)'} (should be Lexington)`)
  console.log(`  surcharge OrderItem       : ${order.orderItems[0]?.description ?? '(none)'} $${order.orderItems[0]?.totalPrice ?? 0}`)

  if (order.orderItems.length === 0) {
    console.log(`\nNo surcharge OrderItem on this order — nothing to backfill.`)
    return
  }

  const lex = await prisma.serviceCenter.findFirst({
    where: { name: 'Lexington' },
    select: { id: true, name: true },
  })
  if (!lex) {
    console.log(`Could not find Lexington service center. Aborting.`)
    return
  }
  console.log(`\nWill set:`)
  console.log(`  serviceAreaSurchargeCents = 5000`)
  console.log(`  serviceAreaCenterId       = ${lex.id} (${lex.name})`)

  if (!APPLY) {
    console.log(`\nDRY RUN — no writes. Re-run with --apply to commit.`)
    await prisma.$disconnect()
    return
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      serviceAreaSurchargeCents: 5000,
      serviceAreaCenterId: lex.id,
    },
  })

  await audit({
    actor: { system: true },
    action: AuditAction.InventoryReassignBulk,
    targetType: 'Order',
    targetId: order.id,
    metadata: {
      source: 'script:_backfill-sarah-surcharge-column',
      reason: "Round-17 fixed column persistence going forward; this backfills Sarah's PPI-MQ8A98MT-60XL row so reporting reflects reality. Surcharge was actually collected via synthetic OrderItem; column just wasn't written.",
      orderNumber: order.orderNumber,
      changes: {
        serviceAreaSurchargeCents: { before: order.serviceAreaSurchargeCents, after: 5000 },
        serviceAreaCenterId: { before: order.serviceAreaCenterId, after: lex.id },
      },
    },
  })

  console.log(`\nAPPLIED. Order row updated + audit row written.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
