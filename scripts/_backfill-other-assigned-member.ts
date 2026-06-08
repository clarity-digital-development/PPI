/**
 * Backfill CustomerOtherItem.assignedToMemberId from descriptions of the form
 * "{AgentName} {rest...}" — the historical workaround we used before adding
 * the assignedToMemberId column. For each row whose description STARTS WITH
 * an active TeamMember name on the row's customer's team, we:
 *
 *   1. Set assignedToMemberId = matchedMember.id
 *   2. Strip the "{AgentName} " prefix from description
 *
 * Match policy:
 *   - Case-insensitive
 *   - Longest-name wins (so "Mary Elsenbroek" doesn't lose to "Mary")
 *   - Requires a trailing space after the name to avoid false hits on
 *     descriptions that merely start with an agent's first letters
 *
 * Safety:
 *   - Default is dry-run. Use --apply to actually write.
 *   - Skips rows that already have assignedToMemberId set (idempotent).
 *   - Skips rows on customers with no team (nothing to assign to).
 *   - Writes a single audit row at the end with full before/after.
 *
 * Usage:
 *   npx tsx scripts/_backfill-other-assigned-member.ts             # dry-run
 *   npx tsx scripts/_backfill-other-assigned-member.ts --apply     # write
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

type PlanRow = {
  itemId: string
  customerEmail: string
  beforeDescription: string
  afterDescription: string
  memberId: string
  memberName: string
}

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { audit, AuditAction } = await import('../lib/audit')

  // Pull every unassigned Other item along with the parent customer's team so
  // we can match agent-name prefixes against the customer's own roster only.
  const items = await prisma.customerOtherItem.findMany({
    where: { assignedToMemberId: null },
    select: {
      id: true,
      description: true,
      user: {
        select: {
          id: true,
          email: true,
          teamId: true,
        },
      },
    },
  })

  console.log(`Scanning ${items.length} unassigned CustomerOtherItem rows...\n`)

  // Cache members per team to avoid N+1 queries.
  const teamMembersCache = new Map<string, Array<{ id: string; name: string }>>()
  async function getMembers(teamId: string) {
    const hit = teamMembersCache.get(teamId)
    if (hit) return hit
    const members = await prisma.teamMember.findMany({
      where: { teamId, removedAt: null },
      select: { id: true, name: true },
    })
    teamMembersCache.set(teamId, members)
    return members
  }

  const plan: PlanRow[] = []
  let skippedNoTeam = 0
  let skippedNoMatch = 0

  for (const it of items) {
    if (!it.user.teamId) {
      skippedNoTeam += 1
      continue
    }
    const members = await getMembers(it.user.teamId)
    // Longest-name-first so "Mary Elsenbroek" wins over "Mary".
    const sorted = [...members].sort((a, b) => b.name.length - a.name.length)
    const lower = it.description.toLowerCase()
    const match = sorted.find((m) => lower.startsWith(m.name.toLowerCase() + ' '))
    if (!match) {
      skippedNoMatch += 1
      continue
    }
    const afterDescription = it.description.slice(match.name.length + 1).trim()
    // Edge case: if stripping leaves an empty description, keep the original
    // so we never write empty strings — admin can clean up manually.
    if (!afterDescription) {
      skippedNoMatch += 1
      continue
    }
    plan.push({
      itemId: it.id,
      customerEmail: it.user.email,
      beforeDescription: it.description,
      afterDescription,
      memberId: match.id,
      memberName: match.name,
    })
  }

  console.log(`Matched ${plan.length} rows.`)
  console.log(`Skipped ${skippedNoTeam} rows (customer has no team).`)
  console.log(`Skipped ${skippedNoMatch} rows (no agent-name prefix match).\n`)

  if (plan.length > 0) {
    console.log('Sample (first 20):')
    for (const p of plan.slice(0, 20)) {
      console.log(`  ${p.itemId}  ${p.customerEmail}`)
      console.log(`    "${p.beforeDescription}"`)
      console.log(`    -> agent="${p.memberName}"  description="${p.afterDescription}"`)
    }
    if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more.`)
    console.log('')
  }

  if (!APPLY) {
    console.log('DRY RUN — no writes. Re-run with --apply to commit.')
    await prisma.$disconnect()
    return
  }

  let updated = 0
  for (const p of plan) {
    await prisma.customerOtherItem.update({
      where: { id: p.itemId },
      data: {
        assignedToMemberId: p.memberId,
        description: p.afterDescription,
      },
    })
    updated += 1
  }

  await audit({
    actor: { system: true },
    action: AuditAction.InventoryReassignBulk,
    targetType: 'CustomerOtherItem',
    targetId: null,
    metadata: {
      source: 'script:_backfill-other-assigned-member',
      reason: 'Backfill assignedToMemberId from "{AgentName} ..." description prefix after adding the column.',
      updated,
      changes: plan.map((p) => ({
        itemId: p.itemId,
        customerEmail: p.customerEmail,
        beforeDescription: p.beforeDescription,
        afterDescription: p.afterDescription,
        memberId: p.memberId,
        memberName: p.memberName,
      })),
    },
  })

  console.log(`\nAPPLIED — updated ${updated} rows, audit row written.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
