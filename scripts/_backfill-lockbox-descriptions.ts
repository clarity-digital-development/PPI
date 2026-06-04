/**
 * One-time backfill: append "— Serial: X · Code: Y" (or just Serial / just
 * Code) to OrderItem.description for lockbox items written BEFORE the
 * round-5 enrichment was deployed. Without this, existing pending orders
 * (e.g. PJ Elder's PPI-MPZUUVAG-4DFJ) show "Sentrilock/Supra Install" with
 * no code anywhere in the customer email or admin order detail, even though
 * the customerLockboxId FK is correctly attached and the code lives on
 * CustomerLockbox.code in inventory.
 *
 * Idempotent — skips rows whose description already contains "Serial:" or
 * "Code:" (i.e. orders placed post-round-5). Skips rows with neither a
 * serial nor a code (nothing to append).
 *
 *   npx tsx scripts/_backfill-lockbox-descriptions.ts
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  lockboxDescriptionSuffix,
  hasLockboxIdentifier,
} from '../lib/orders/lockbox-description'

// Load env (.env.local overrides .env) so DATABASE_URL is available.
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set. Aborting.')
  process.exit(1)
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString })),
})

async function main() {
  // PJ Elder's order — we surface its before/after explicitly so Ryan can
  // verify the fix landed on the row he reviewed.
  const PJ_ORDER_NUMBER = 'PPI-MPZUUVAG-4DFJ'

  const candidates = await prisma.orderItem.findMany({
    where: { itemType: 'lockbox', customerLockboxId: { not: null } },
    select: {
      id: true,
      description: true,
      customerLockboxId: true,
      orderId: true,
      order: { select: { orderNumber: true } },
    },
  })

  console.log(`Scanning ${candidates.length} lockbox items with a customerLockboxId FK…`)

  let updated = 0
  let skippedAlreadyEnriched = 0
  let skippedNoSerialNoCode = 0
  let skippedMissingLockbox = 0
  const pjBeforeAfter: Array<{ itemId: string; before: string; after: string }> = []

  for (const item of candidates) {
    if (hasLockboxIdentifier(item.description)) {
      skippedAlreadyEnriched++
      continue
    }
    if (!item.customerLockboxId) continue // narrow types — already filtered

    const lb = await prisma.customerLockbox.findUnique({
      where: { id: item.customerLockboxId },
      select: { serialNumber: true, code: true },
    })
    if (!lb) {
      skippedMissingLockbox++
      continue
    }

    const suffix = lockboxDescriptionSuffix({ serialNumber: lb.serialNumber, code: lb.code })
    if (!suffix) {
      skippedNoSerialNoCode++
      continue
    }

    const before = item.description
    const after = `${before}${suffix}`
    await prisma.orderItem.update({ where: { id: item.id }, data: { description: after } })
    updated++

    if (item.order?.orderNumber === PJ_ORDER_NUMBER) {
      pjBeforeAfter.push({ itemId: item.id, before, after })
    }
  }

  console.log('\nResults:')
  console.log({
    scanned: candidates.length,
    updated,
    skippedAlreadyEnriched,
    skippedNoSerialNoCode,
    skippedMissingLockbox,
  })

  if (pjBeforeAfter.length) {
    console.log(`\nPJ Elder order (${PJ_ORDER_NUMBER}) — before/after:`)
    for (const row of pjBeforeAfter) console.log(row)
  } else {
    console.log(`\nNote: PJ Elder order (${PJ_ORDER_NUMBER}) was not in the updated set this run (likely already enriched or no longer pending).`)
  }

  // One audit row marking the bulk correction. Re-use InventoryReassignBulk
  // since we have no dedicated "data correction" constant.
  await prisma.auditLog.create({
    data: {
      action: 'inventory.reassign.bulk',
      targetType: 'OrderItem',
      targetId: null,
      actorRole: 'system',
      metadata: {
        source: 'script:_backfill-lockbox-descriptions',
        updated,
        skippedAlreadyEnriched,
        skippedNoSerialNoCode,
        skippedMissingLockbox,
        reason:
          'enrich pre-round-5 lockbox descriptions with serial/code so customer confirmation + admin emails display the physical id',
      },
    },
  })

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
