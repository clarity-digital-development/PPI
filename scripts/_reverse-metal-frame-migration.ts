/**
 * Reverse the round-12 migration for "Metal Frame" / "Metal Post" items.
 * Round 12 moved CustomerOtherItem rows that matched "{AgentName} Metal Frame"
 * or "{AgentName} Metal Post" patterns into CustomerSign with the agent name
 * stripped to the assignedToMemberId. Per Ryan's correction, those items are
 * NOT actually signs — they belong back in the Other bucket. The "For Sale"
 * rows that also moved are real signs and STAY.
 *
 * Usage:
 *   npx tsx scripts/_reverse-metal-frame-migration.ts              # dry-run
 *   npx tsx scripts/_reverse-metal-frame-migration.ts --apply      # writes
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

  // Match the descriptions Ryan flagged: "Metal Frame" and "Metal Post"
  // The migration STRIPPED the agent-name prefix and set assignedToMemberId,
  // so we look for CustomerSign rows whose description is exactly the type.
  const candidates = await prisma.customerSign.findMany({
    where: {
      description: { in: ['Metal Frame', 'Metal Post'] },
    },
    select: {
      id: true,
      userId: true,
      description: true,
      assignedToMemberId: true,
      inStorage: true,
      createdAt: true,
      user: { select: { email: true, fullName: true } },
    },
  })

  console.log(`Found ${candidates.length} CustomerSign rows to reverse:\n`)

  type Plan = {
    sign: typeof candidates[number]
    otherDescription: string
    agentName: string | null
  }
  const plan: Plan[] = []

  for (const c of candidates) {
    let agentName: string | null = null
    if (c.assignedToMemberId) {
      const member = await prisma.teamMember.findUnique({
        where: { id: c.assignedToMemberId },
        select: { name: true },
      })
      agentName = member?.name ?? null
    }
    // Reconstruct the original "{AgentName} {ItemType}" format
    const otherDescription = agentName
      ? `${agentName} ${c.description}`
      : c.description
    plan.push({ sign: c, otherDescription, agentName })

    console.log(`  CustomerSign ${c.id}`)
    console.log(`    user      : ${c.user.email}`)
    console.log(`    description: "${c.description}"`)
    console.log(`    assigned  : ${agentName ?? '(unassigned)'}`)
    console.log(`    -> Other  : "${otherDescription}"`)
    console.log('')
  }

  if (!APPLY) {
    console.log(`DRY RUN — no writes. Re-run with --apply to commit.`)
    console.log(`Plan: create ${plan.length} CustomerOtherItem rows, delete ${plan.length} CustomerSign rows.`)
    await prisma.$disconnect()
    return
  }

  let migrated = 0
  for (const { sign, otherDescription } of plan) {
    await prisma.$transaction([
      prisma.customerOtherItem.create({
        data: {
          userId: sign.userId,
          description: otherDescription,
        },
      }),
      prisma.customerSign.delete({
        where: { id: sign.id },
      }),
    ])
    migrated += 1
  }

  await audit({
    actor: { system: true },
    action: AuditAction.InventoryReassignBulk,
    targetType: 'CustomerSign',
    targetId: null,
    metadata: {
      source: 'script:_reverse-metal-frame-migration',
      reason: "Per Ryan's correction: Metal Frame / Metal Post items moved by round-12 migration are not signs and belong back in Other.",
      reversedCount: migrated,
      candidates: plan.map(p => ({
        signId: p.sign.id,
        userEmail: p.sign.user.email,
        originalDescription: p.sign.description,
        restoredDescription: p.otherDescription,
        agentName: p.agentName,
      })),
    },
  })

  console.log(`\nAPPLIED — reversed ${migrated} rows, audit row written.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
