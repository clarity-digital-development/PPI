/**
 * One-time data correction: recategorize rows in `customer_other_items` into
 * their proper typed table (CustomerSign / CustomerRider / CustomerLockbox /
 * CustomerBrochureBox). The Other table is a catch-all that team-admins
 * historically dumped real inventory into, polluting the admin's per-customer
 * view with a generic "Other items" bucket.
 *
 * Parser:
 *   1. norm = description.trim().replace(/\s+/g, ' ')
 *   2. If --include-tests not set, skip rows matching /\btest\b|asdf|^\.+$/i.
 *   3. If parent customer has a team, try to peel an agent-name prefix that
 *      matches one of their active TeamMembers (case-insensitive, first match).
 *   4. Route remainder by keyword regex (see TYPE_ROUTING below).
 *
 * Safety:
 *   - Default is --dry-run (NO writes). Use --apply to actually write.
 *   - Each row's migration is wrapped in a Prisma interactive transaction so
 *     we cannot half-migrate (create-new + delete-old must succeed atomically).
 *   - Hard refuses to run on any non-dev DB if processed > 200 (safety guard
 *     against catalog explosion if dataset balloons unexpectedly).
 *
 * Idempotency: source-of-truth is the customer_other_items table — once a row
 * is deleted it's gone, so a re-run finds nothing to do.
 *
 * Usage:
 *   npx tsx scripts/_recategorize-other-items.ts            # dry-run (default)
 *   npx tsx scripts/_recategorize-other-items.ts --apply    # write
 *   npx tsx scripts/_recategorize-other-items.ts --apply --include-tests
 */
import { readFileSync, writeFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

// Load env (.env.local overrides .env) so DATABASE_URL is available before
// Prisma client init.
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

// CLI flags
const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const INCLUDE_TESTS = args.has('--include-tests')
const DRY_RUN = !APPLY

type TargetTable = 'sign' | 'rider' | 'lockbox' | 'brochure_box'

interface ParseDecision {
  skip: boolean
  reason?: string
  target?: TargetTable
  remainder?: string             // cleaned description (post agent-prefix peel)
  memberId?: string | null       // matched TeamMember.id, null = unassigned
  memberName?: string | null     // for log readability
  matchedKeyword?: string        // which regex bucket fired
}

const TEST_REGEX = /\btest\b|asdf|^\.+$/i

function parseRow(
  description: string,
  parent: { teamId: string | null; teamMembers: { id: string; name: string; removedAt: Date | null }[] },
  warnings: { rowId: string; description: string; matches: string[] }[],
  rowId: string,
): ParseDecision {
  const norm = description.trim().replace(/\s+/g, ' ')
  if (!norm) return { skip: true, reason: 'empty description' }

  if (!INCLUDE_TESTS && TEST_REGEX.test(norm)) {
    return { skip: true, reason: 'matches test pattern' }
  }

  // 1) Agent-prefix peel — only if customer has a team. First match wins;
  //    push a warning if 2+ active members would all match (zero today per
  //    Explorer C, but defend the future against duplicate names).
  let memberId: string | null = null
  let memberName: string | null = null
  let remainder = norm
  if (parent.teamId && parent.teamMembers.length > 0) {
    const lowerNorm = norm.toLowerCase()
    const allMatches: { id: string; name: string }[] = []
    for (const m of parent.teamMembers) {
      if (m.removedAt) continue
      const prefix = `${m.name.toLowerCase()} `
      if (lowerNorm.startsWith(prefix)) allMatches.push({ id: m.id, name: m.name })
    }
    if (allMatches.length >= 1) {
      memberId = allMatches[0].id
      memberName = allMatches[0].name
      remainder = norm.slice(allMatches[0].name.length).trim()
      if (allMatches.length > 1) {
        warnings.push({
          rowId,
          description: norm,
          matches: allMatches.map((a) => `${a.name} (${a.id})`),
        })
      }
    }
  }

  const typeStr = remainder
  const lower = typeStr.toLowerCase()

  // 2) Type routing — order matters. The exclusions exist to handle the
  //    specific edge cases surfaced by Explorer C against current prod data.
  //    - "stake for lockbox" is a sign accessory, not a lockbox.
  //    - "brochure box frame" is technically a sign (the frame), not a box.
  if (/\brider\b/i.test(lower)) {
    return { skip: true, reason: 'rider keyword — needs riderId FK lookup (no rider rows in current dataset)' }
  }
  if (/\bbrochure\b/i.test(lower) && !/brochure\s+box\s+frame/i.test(lower)) {
    return { skip: false, target: 'brochure_box', remainder, memberId, memberName, matchedKeyword: 'brochure' }
  }
  if (/\blockbox\b/i.test(lower) && !/stake\s+for\s+lockbox/i.test(lower)) {
    return { skip: true, reason: 'lockbox keyword — needs lockboxTypeId FK lookup (no lockbox-only rows in current dataset)' }
  }
  if (/frame|post|sign|bracket|directional|wire|metal|for sale|open house|neighborhood|stake/i.test(lower)) {
    return { skip: false, target: 'sign', remainder, memberId, memberName, matchedKeyword: 'sign-family' }
  }

  return { skip: true, reason: `unparseable: "${norm}"` }
}

interface NeedsReview {
  id: string
  userId: string
  userEmail: string
  description: string
  reason: string
}

async function main() {
  console.log('='.repeat(70))
  console.log(`MODE: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY (will write)'}`)
  console.log(`INCLUDE_TESTS: ${INCLUDE_TESTS}`)
  console.log('='.repeat(70))

  const rows = await prisma.customerOtherItem.findMany({
    include: {
      user: {
        select: {
          id: true,
          email: true,
          teamId: true,
          team: {
            select: {
              id: true,
              name: true,
              teamMembers: { select: { id: true, name: true, removedAt: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\nScanned ${rows.length} CustomerOtherItem rows.`)

  // Hard safety guard — refuse runaway runs on prod.
  if (rows.length > 200) {
    console.error(`REFUSING: ${rows.length} rows > 200 safety cap. Re-evaluate the dataset before re-running.`)
    await prisma.$disconnect()
    process.exit(2)
  }

  const warnings: { rowId: string; description: string; matches: string[] }[] = []
  const needsReview: NeedsReview[] = []

  type Plan = {
    rowId: string
    userEmail: string
    description: string
    decision: ParseDecision
  }
  const plan: Plan[] = []

  for (const row of rows) {
    const decision = parseRow(
      row.description,
      { teamId: row.user.teamId, teamMembers: row.user.team?.teamMembers ?? [] },
      warnings,
      row.id,
    )
    if (decision.skip) {
      needsReview.push({
        id: row.id,
        userId: row.userId,
        userEmail: row.user.email,
        description: row.description,
        reason: decision.reason ?? 'unknown',
      })
      continue
    }
    plan.push({ rowId: row.id, userEmail: row.user.email, description: row.description, decision })
  }

  // Print the parsed action for every row — required by spec for visibility
  // before any writes. Group by target for readability.
  console.log('\n--- PARSED PLAN ---')
  const byTarget: Record<TargetTable, Plan[]> = { sign: [], rider: [], lockbox: [], brochure_box: [] }
  for (const p of plan) byTarget[p.decision.target!].push(p)
  for (const target of Object.keys(byTarget) as TargetTable[]) {
    const list = byTarget[target]
    if (list.length === 0) continue
    console.log(`\n  → ${target} (${list.length}):`)
    for (const p of list) {
      const agent = p.decision.memberName ? ` [agent=${p.decision.memberName}]` : ' [unassigned]'
      console.log(`     ${p.rowId.slice(-6)}  ${p.userEmail.padEnd(34)}  "${p.description}"${agent}`)
    }
  }

  console.log(`\n--- NEEDS REVIEW (${needsReview.length}) ---`)
  for (const n of needsReview) {
    console.log(`  ${n.id.slice(-6)}  ${n.userEmail.padEnd(34)}  "${n.description}"  reason=${n.reason}`)
  }

  if (warnings.length > 0) {
    console.log(`\n--- AGENT MATCH WARNINGS (${warnings.length}) ---`)
    for (const w of warnings) {
      console.log(`  rowId=${w.rowId}  desc="${w.description}"  matches=[${w.matches.join(', ')}]`)
    }
  }

  // ===== Execute =====
  let created = 0
  let deleted = 0
  const counters = { sign: 0, rider: 0, lockbox: 0, brochure_box: 0 }
  const skippedTestData = needsReview.filter((n) => n.reason === 'matches test pattern').length
  const skippedUnparseable = needsReview.length - skippedTestData

  if (DRY_RUN) {
    console.log('\nDRY-RUN — no writes performed. Re-run with --apply to commit.')
  } else {
    console.log('\n--- APPLYING ---')
    for (const p of plan) {
      const d = p.decision
      const target = d.target!
      const row = rows.find((r) => r.id === p.rowId)!

      try {
        await prisma.$transaction(async (tx) => {
          // Create the typed row. Description is the cleaned remainder
          // (post agent-prefix peel) so labels match what the team-admin
          // will see in their per-agent view.
          const data = {
            userId: row.userId,
            description: d.remainder ?? row.description,
            inStorage: true,
            assignedToMemberId: d.memberId ?? null,
            createdAt: row.createdAt,
          }

          if (target === 'sign') {
            await tx.customerSign.create({ data })
          } else if (target === 'brochure_box') {
            await tx.customerBrochureBox.create({ data })
          } else {
            // rider / lockbox are gated by the parser (returns skip) — defensive
            // throw so we abort if logic ever changes without FK wiring.
            throw new Error(`unexpected target=${target} for row=${p.rowId} — rider/lockbox need FK plumbing`)
          }
          await tx.customerOtherItem.delete({ where: { id: row.id } })
        })
        created++
        deleted++
        counters[target]++
        console.log(`  ✓ ${target.padEnd(13)} ${p.rowId.slice(-6)}  "${d.remainder ?? row.description}"`)
      } catch (err) {
        console.error(`  ✗ FAILED  ${p.rowId}  ${err instanceof Error ? err.message : String(err)}`)
        needsReview.push({
          id: row.id,
          userId: row.userId,
          userEmail: row.user.email,
          description: row.description,
          reason: `transaction error: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  }

  // Report file
  const reportPath = 'scripts/_recategorize-other-items.report.json'
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        mode: DRY_RUN ? 'dry-run' : 'apply',
        includeTests: INCLUDE_TESTS,
        timestamp: new Date().toISOString(),
        scanned: rows.length,
        planned: plan.length,
        created,
        deleted,
        skipped: needsReview.length,
        skippedTestData,
        skippedUnparseable,
        byTarget: counters,
        needs_review: needsReview,
        agent_match_warnings: warnings,
      },
      null,
      2,
    ),
  )

  console.log('\n--- SUMMARY ---')
  console.log({
    mode: DRY_RUN ? 'dry-run' : 'apply',
    scanned: rows.length,
    planned: plan.length,
    created,
    deleted,
    skippedTestData,
    skippedUnparseable,
    byTarget: counters,
    reportPath,
  })

  // Single audit row at the end (apply runs only). Re-use InventoryReassignBulk
  // since we have no dedicated "data correction" constant — matches the
  // precedent set by _backfill-lockbox-descriptions.
  if (!DRY_RUN) {
    await prisma.auditLog.create({
      data: {
        action: 'inventory.reassign.bulk',
        targetType: 'CustomerOtherItem',
        targetId: null,
        actorRole: 'system',
        metadata: {
          source: 'script:_recategorize-other-items',
          totalScanned: rows.length,
          migratedSigns: counters.sign,
          migratedRiders: counters.rider,
          migratedLockboxes: counters.lockbox,
          migratedBrochureBoxes: counters.brochure_box,
          skippedTestData,
          skippedUnparseable,
          unparseableDescriptions: needsReview.map((n) => ({
            id: n.id,
            userEmail: n.userEmail,
            description: n.description,
            reason: n.reason,
          })),
          reason:
            'recategorize CustomerOtherItem dump into proper typed inventory tables so admin team-admin view stops showing the catch-all "Other items" bucket',
        },
      },
    })
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
