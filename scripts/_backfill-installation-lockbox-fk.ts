/**
 * One-time backfill: link historical InstallationLockbox rows to their
 * source CustomerLockbox via the new customerLockboxId FK, and copy the
 * inventory .code over to InstallationLockbox.code when the latter is
 * NULL. Without this, the round-7 SR-email "Existing lockboxes at this
 * property" block renders "(Code: —)" for ~95% of historical
 * installations because the code was never carried over at install time.
 *
 * Derivation: Installation.orderId -> Order.orderItems where
 *   itemType='lockbox' AND customerLockboxId IS NOT NULL. If multiple
 *   lockbox OrderItems exist on the same order, disambiguate by matching
 *   InstallationLockbox.lockboxTypeId === CustomerLockbox.lockboxTypeId
 *   (via the OrderItem's customerLockbox). If still ambiguous, skip
 *   + log so a human can resolve.
 *
 * Idempotent — rows that already have customerLockboxId set are skipped.
 *
 *   npx tsx scripts/_backfill-installation-lockbox-fk.ts
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

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

interface SkipRecord {
  installationLockboxId: string
  installationId: string
  reason: string
  detail?: unknown
}

async function main() {
  const candidates = await prisma.installationLockbox.findMany({
    where: { customerLockboxId: null },
    select: {
      id: true,
      installationId: true,
      lockboxTypeId: true,
      customerLockboxId: true,
      code: true,
    },
  })

  console.log(`Scanning ${candidates.length} InstallationLockbox rows with NULL customerLockboxId…`)

  let scanned = candidates.length
  let linkedAndCodeCopied = 0
  let linkedFkOnly = 0
  let skippedAmbiguous = 0
  let skippedNoMatch = 0
  let skippedMissingLockbox = 0
  const samples: Array<{ installationLockboxId: string; before: unknown; after: unknown }> = []
  const skips: SkipRecord[] = []

  for (const il of candidates) {
    const installation = await prisma.installation.findUnique({
      where: { id: il.installationId },
      include: {
        order: {
          include: {
            orderItems: {
              where: { itemType: 'lockbox', customerLockboxId: { not: null } },
            },
          },
        },
      },
    })

    if (!installation || !installation.order) {
      skippedNoMatch++
      skips.push({
        installationLockboxId: il.id,
        installationId: il.installationId,
        reason: 'installation-or-order-missing',
      })
      continue
    }

    const lockboxItems = installation.order.orderItems
    if (lockboxItems.length === 0) {
      skippedNoMatch++
      skips.push({
        installationLockboxId: il.id,
        installationId: il.installationId,
        reason: 'no-lockbox-orderitems-with-customerLockboxId',
      })
      continue
    }

    // Common case: exactly one lockbox OrderItem on the order.
    let chosenCustomerLockboxId: string | null = null
    if (lockboxItems.length === 1) {
      chosenCustomerLockboxId = lockboxItems[0].customerLockboxId
    } else {
      // Disambiguate by matching lockboxTypeId via CustomerLockbox.
      const candidateIds = lockboxItems
        .map((oi) => oi.customerLockboxId)
        .filter((v): v is string => !!v)
      const candidateLockboxes = await prisma.customerLockbox.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, lockboxTypeId: true },
      })
      const typeMatches = candidateLockboxes.filter(
        (cl) => cl.lockboxTypeId === il.lockboxTypeId,
      )
      if (typeMatches.length === 1) {
        chosenCustomerLockboxId = typeMatches[0].id
      } else {
        skippedAmbiguous++
        skips.push({
          installationLockboxId: il.id,
          installationId: il.installationId,
          reason:
            typeMatches.length === 0
              ? 'multiple-lockbox-orderitems-no-type-match'
              : 'multiple-lockbox-orderitems-multiple-type-matches',
          detail: {
            orderItemLockboxIds: candidateIds,
            installationLockboxType: il.lockboxTypeId,
            typeMatchedLockboxIds: typeMatches.map((c) => c.id),
          },
        })
        continue
      }
    }

    if (!chosenCustomerLockboxId) {
      skippedNoMatch++
      skips.push({
        installationLockboxId: il.id,
        installationId: il.installationId,
        reason: 'no-customerLockboxId-on-orderitem',
      })
      continue
    }

    const sourceLockbox = await prisma.customerLockbox.findUnique({
      where: { id: chosenCustomerLockboxId },
      select: { id: true, code: true, serialNumber: true, lockboxTypeId: true },
    })
    if (!sourceLockbox) {
      skippedMissingLockbox++
      skips.push({
        installationLockboxId: il.id,
        installationId: il.installationId,
        reason: 'source-customer-lockbox-missing',
        detail: { customerLockboxId: chosenCustomerLockboxId },
      })
      continue
    }

    const shouldCopyCode = !il.code && !!sourceLockbox.code
    const before = { customerLockboxId: il.customerLockboxId, code: il.code }
    const updated = await prisma.installationLockbox.update({
      where: { id: il.id },
      data: {
        customerLockboxId: sourceLockbox.id,
        ...(shouldCopyCode ? { code: sourceLockbox.code } : {}),
      },
      select: { id: true, customerLockboxId: true, code: true },
    })

    if (shouldCopyCode) linkedAndCodeCopied++
    else linkedFkOnly++

    if (samples.length < 3) {
      samples.push({
        installationLockboxId: il.id,
        before,
        after: { customerLockboxId: updated.customerLockboxId, code: updated.code },
      })
    }
  }

  const counts = {
    scanned,
    linkedAndCodeCopied,
    linkedFkOnly,
    skippedAmbiguous,
    skippedNoMatch,
    skippedMissingLockbox,
  }

  console.log('\nResults:')
  console.log(counts)

  if (samples.length) {
    console.log('\nSample updated rows (before/after):')
    for (const s of samples) console.log(JSON.stringify(s, null, 2))
  }

  if (skips.length) {
    console.log('\nSkips:')
    for (const s of skips) console.log(JSON.stringify(s))
  }

  // One audit row marking the bulk correction. Re-use InventoryReassignBulk
  // since we have no dedicated "data correction" constant.
  await prisma.auditLog.create({
    data: {
      action: 'inventory.reassign.bulk',
      targetType: 'InstallationLockbox',
      targetId: null,
      actorRole: 'system',
      metadata: {
        source: 'script:_backfill-installation-lockbox-fk',
        ...counts,
        reason:
          'link historical InstallationLockbox rows to source CustomerLockbox via new FK + copy missing code so SR-email "existing lockboxes" block renders live inventory code',
      },
    },
  })

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
