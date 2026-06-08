/**
 * Per Tanner's correction after the metal-frame reversal:
 * "they're not metal posts, just normal posts."
 *
 * Renames CustomerOtherItem rows where description contains "Metal Post"
 * to use "Post" instead. Metal Frame items are left untouched.
 *
 * Usage:
 *   npx tsx scripts/_rename-metal-post-to-post.ts              # dry-run
 *   npx tsx scripts/_rename-metal-post-to-post.ts --apply      # writes
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

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { audit, AuditAction } = await import('../lib/audit')

  const candidates = await prisma.customerOtherItem.findMany({
    where: { description: { contains: 'Metal Post' } },
    select: {
      id: true,
      description: true,
      user: { select: { email: true } },
    },
  })

  console.log(`Found ${candidates.length} CustomerOtherItem rows with "Metal Post":\n`)
  const plan = candidates.map((c) => ({
    id: c.id,
    userEmail: c.user.email,
    before: c.description,
    after: c.description.replace(/Metal Post/g, 'Post'),
  }))

  for (const p of plan) {
    console.log(`  ${p.id}  (${p.userEmail})`)
    console.log(`    "${p.before}" -> "${p.after}"`)
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — no writes. Re-run with --apply to commit.`)
    await prisma.$disconnect()
    return
  }

  let updated = 0
  for (const p of plan) {
    await prisma.customerOtherItem.update({
      where: { id: p.id },
      data: { description: p.after },
    })
    updated += 1
  }

  await audit({
    actor: { system: true },
    action: AuditAction.InventoryReassignBulk,
    targetType: 'CustomerOtherItem',
    targetId: null,
    metadata: {
      source: 'script:_rename-metal-post-to-post',
      reason: "Per Tanner's correction: 'they're not metal posts, just normal posts.'",
      updatedCount: updated,
      changes: plan,
    },
  })

  console.log(`\nAPPLIED — renamed ${updated} rows, audit row written.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
