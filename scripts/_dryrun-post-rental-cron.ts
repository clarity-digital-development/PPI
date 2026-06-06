// Dry-run verification for the post-rental cron.
// Mirrors the cron's Pass 1 logic against the live DB WITHOUT writing
// or calling Stripe. Confirms zero charges fire with the dormant default.

import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// Inline copy of the lib (to avoid Next/Prisma path-alias resolution in raw tsx).
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const targetMonth = d.getUTCMonth() + months
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(targetMonth)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d
}

type DueChargeType = 'six_month' | 'nine_month' | 'monthly'
interface DueCharge { periodStart: Date; periodEnd: Date; chargeType: DueChargeType; amountCents: number }

function chargesDue(installedAt: Date, now: Date): DueCharge[] {
  const out: DueCharge[] = []
  const six = addMonths(installedAt, 6)
  if (six <= now) out.push({ periodStart: six, periodEnd: addMonths(installedAt, 9), chargeType: 'six_month', amountCents: 1800 })
  const nine = addMonths(installedAt, 9)
  if (nine <= now) out.push({ periodStart: nine, periodEnd: addMonths(installedAt, 12), chargeType: 'nine_month', amountCents: 1800 })
  for (let k = 0; k < 600; k++) {
    const s = addMonths(installedAt, 12 + k)
    if (s > now) break
    out.push({ periodStart: s, periodEnd: addMonths(installedAt, 13 + k), chargeType: 'monthly', amountCents: 600 })
  }
  return out
}

function getBillingStartAt(): Date {
  const raw = process.env.POST_RENTAL_BILLING_START_AT || '2099-01-01T00:00:00Z'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return new Date('2099-01-01T00:00:00Z')
  return parsed
}

interface EligibilityIn { order: any; now: Date; billingStartAt: Date }
type ER = { eligible: true } | { eligible: false; reason: string }
function isPostRentalEligible(input: EligibilityIn): ER {
  const { order, now, billingStartAt } = input
  const inst = order.installation
  if (!inst || inst.status !== 'active') return { eligible: false, reason: 'no_active_installation' }
  if (order.postRentalStoppedAt != null) return { eligible: false, reason: 'already_stopped' }
  if (inst.removalDate != null) {
    const sixA = addMonths(inst.installedAt, 6)
    if (inst.removalDate < sixA) return { eligible: false, reason: 'pickup_before_6mo' }
    return { eligible: false, reason: 'pickup_scheduled' }
  }
  if (order.user.role === 'admin') return { eligible: false, reason: 'exempt_role_admin' }
  if (order.user.role === 'team_admin') return { eligible: false, reason: 'exempt_role_team_admin' }
  if (order.user.isServiceAreaExempt) return { eligible: false, reason: 'exempt_per_customer' }
  if (inst.installedAt < billingStartAt && !order.postRentalEnabledOverride) return { eligible: false, reason: 'grandfathered' }
  if (order.status !== 'completed') return { eligible: false, reason: 'order_not_completed' }
  if (order.paymentStatus !== 'succeeded') return { eligible: false, reason: 'payment_not_succeeded' }
  void now
  return { eligible: true }
}

async function main() {
  const now = new Date()
  const billingStartAt = getBillingStartAt()
  console.log(`[dry-run] now=${now.toISOString()}`)
  console.log(`[dry-run] BILLING_START_AT=${billingStartAt.toISOString()}`)
  console.log(`[dry-run] env POST_RENTAL_BILLING_START_AT=${process.env.POST_RENTAL_BILLING_START_AT ?? '(unset - dormant default)'}`)

  const orders = await prisma.order.findMany({
    where: {
      status: 'completed',
      paymentStatus: 'succeeded',
      postRentalStoppedAt: null,
      installation: { is: { status: 'active' } },
    },
    include: { user: true, installation: true },
  })
  console.log(`[dry-run] scanned ${orders.length} candidate orders`)

  const reasonCounts: Record<string, number> = {}
  let eligible = 0
  let wouldSchedule = 0
  for (const order of orders) {
    const elig = isPostRentalEligible({ order, now, billingStartAt })
    if (!elig.eligible) {
      reasonCounts[elig.reason] = (reasonCounts[elig.reason] || 0) + 1
      continue
    }
    eligible++
    const due = chargesDue(order.installation!.installedAt, now)
    wouldSchedule += due.length
  }
  console.log(`[dry-run] eligible: ${eligible}`)
  console.log(`[dry-run] would-schedule charge rows: ${wouldSchedule}`)
  console.log(`[dry-run] skipped breakdown:`)
  for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`           ${k.padEnd(28)} ${v}`)
  }

  const dueRowsCount = await prisma.postRentalCharge.count({
    where: { status: 'scheduled', periodStart: { lte: now } },
  })
  console.log(`[dry-run] existing scheduled rows already due: ${dueRowsCount}`)

  await prisma.$disconnect()
  await pool.end()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  await pool.end()
  process.exit(1)
})
