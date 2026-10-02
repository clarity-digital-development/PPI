import type { Order, User, Installation } from '@prisma/client'

// ───────────────────────── env-driven switch ─────────────────────────

// Dormant by default — Tanner flips POST_RENTAL_BILLING_START_AT to a real
// ISO date when ready to go live. The far-future default (2099) ensures the
// cron never charges anyone historically by accident.
const DORMANT_DEFAULT = '2099-01-01T00:00:00Z'

export function getBillingStartAt(): Date {
  const raw = process.env.POST_RENTAL_BILLING_START_AT || DORMANT_DEFAULT
  const parsed = new Date(raw)
  // Bad value → stay dormant rather than charge everyone.
  if (Number.isNaN(parsed.getTime())) return new Date(DORMANT_DEFAULT)
  return parsed
}

// Exposed for diagnostics / dry-run output.
export const BILLING_START_AT = {
  get value(): Date {
    return getBillingStartAt()
  },
}

// ───────────────────────── pure math: addMonths ─────────────────────────

// Calendar-month addition that preserves the day-of-month when possible and
// clamps to month-end when not (e.g. Jan 31 + 1mo → Feb 28/29). Mirrors the
// date-fns/addMonths semantics referenced in the spec.
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const targetMonth = d.getUTCMonth() + months
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(targetMonth)
  const lastDayOfTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate()
  d.setUTCDate(Math.min(day, lastDayOfTargetMonth))
  return d
}

// ───────────────────────── chargesDue ─────────────────────────

export type DueChargeType = 'six_month' | 'nine_month' | 'monthly'

export interface DueCharge {
  periodStart: Date
  periodEnd: Date
  chargeType: DueChargeType
  amountCents: number
}

/**
 * Pure function — returns every charge whose periodStart <= now anchored on
 * installedAt. Cron inserts missing rows; the (orderId, periodStart) unique
 * constraint dedupes against prior runs. No I/O here.
 *
 * Schedule:
 *   T+6mo  → $18 covering months 7-9   (six_month)
 *   T+9mo  → $18 covering months 10-12 (nine_month)
 *   T+12mo, T+13mo, … → $6 each (monthly)
 */
export function chargesDue(installedAt: Date, now: Date): DueCharge[] {
  const out: DueCharge[] = []

  const sixStart = addMonths(installedAt, 6)
  if (sixStart <= now) {
    out.push({
      periodStart: sixStart,
      periodEnd: addMonths(installedAt, 9),
      chargeType: 'six_month',
      amountCents: 1800,
    })
  }

  const nineStart = addMonths(installedAt, 9)
  if (nineStart <= now) {
    out.push({
      periodStart: nineStart,
      periodEnd: addMonths(installedAt, 12),
      chargeType: 'nine_month',
      amountCents: 1800,
    })
  }

  // Monthly tail from month 12 onward — emit every period whose start <= now.
  for (let k = 0; k < 600; k++) {
    const start = addMonths(installedAt, 12 + k)
    if (start > now) break
    out.push({
      periodStart: start,
      periodEnd: addMonths(installedAt, 13 + k),
      chargeType: 'monthly',
      amountCents: 600,
    })
  }

  return out
}

// ───────────────────────── eligibility ─────────────────────────

export type EligibilityReason =
  | 'no_active_installation'
  | 'already_stopped'
  | 'manual_opt_out'
  | 'pickup_before_6mo'
  | 'pickup_scheduled'
  | 'exempt_role_admin'
  | 'account_not_charged'
  | 'grandfathered'
  | 'order_not_completed'
  | 'payment_not_succeeded'

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityReason }

export interface EligibilityInput {
  order: Order & { user: User; placedBy: User | null; installation: Installation | null }
  now: Date
  billingStartAt: Date
}

/**
 * The account a post's rental is billed to: whoever pays for the order
 * (placedBy ?? user) — the same rule as the out-of-area fee. Its
 * postRentalChargedFrom decides WHETHER rental is charged and from when, and
 * its invoiceBilling decides HOW: card on file, or the next bundled invoice
 * (Ryan, 2026-09-28).
 */
export function rentalPayer<U extends { postRentalChargedFrom: Date | null; invoiceBilling: boolean }>(order: {
  user: U
  placedBy: U | null
}): U {
  return order.placedBy ?? order.user
}

/**
 * Whether one rental period is billable to this payer: the account is
 * charged at all, and the period starts on or after the moment it was turned
 * on — switching an account on never back-bills periods already under way.
 */
export function payerChargesPeriod(
  payer: { postRentalChargedFrom: Date | null },
  periodStart: Date,
): boolean {
  return payer.postRentalChargedFrom != null && periodStart >= payer.postRentalChargedFrom
}

/**
 * Eligibility predicate per spec section 2. Short-circuits in stated order.
 * Caller decides what to do on `{ eligible: false }`: cron skips creating
 * new rows; admin UI surfaces the reason string in the rental card.
 */
export function isPostRentalEligible(
  input: EligibilityInput
): EligibilityResult {
  const { order, now, billingStartAt } = input
  const inst = order.installation

  // (1) No post in the ground (or already pulled) — nothing to bill.
  if (!inst || inst.status !== 'active') {
    return { eligible: false, reason: 'no_active_installation' }
  }

  // (2) Cron previously observed pickup — clock is stopped, hard halt.
  if (order.postRentalStoppedAt != null) {
    return { eligible: false, reason: 'already_stopped' }
  }

  // (2.5) Admin manually opted this order OUT of post-rental billing — e.g. the
  // agent supplied their own post, so PPI charges no recurring rental. This
  // wins over the grandfathered opt-in override below.
  if (order.postRentalDisabled) {
    return { eligible: false, reason: 'manual_opt_out' }
  }

  // (3) Removal scheduled before 6-month anniversary → suppress entirely.
  if (inst.removalDate != null) {
    const sixMonthAnniversary = addMonths(inst.installedAt, 6)
    if (inst.removalDate < sixMonthAnniversary) {
      return { eligible: false, reason: 'pickup_before_6mo' }
    }
    // Removal scheduled at or after 6mo: cron should mark stopped on its
    // next pass but in-flight scheduled rows still fire (handled in cron).
    return { eligible: false, reason: 'pickup_scheduled' }
  }

  // (4) Exemptions. Internal staff orders never rent. Everyone else goes by
  // the paying account's own switch (Ryan, 2026-09-28) — it used to be
  // blanket rules: every broker account, every out-of-area-exempt account,
  // and every invoice account skipped rental. At the switch-over
  // (2026-10-02) Semonin, the internal test account and the admin stayed off
  // ("Semonin I'm ok w"); every other brokerage was switched on from that day
  // ("these future brokerages definitely need to charge"). Invoice accounts
  // are no longer skipped: their rental goes on their next invoice (cron
  // Pass 2), never on a card.
  if (order.user.role === 'admin') {
    return { eligible: false, reason: 'exempt_role_admin' }
  }
  if (rentalPayer(order).postRentalChargedFrom == null) {
    return { eligible: false, reason: 'account_not_charged' }
  }

  // (5) Grandfathered — installed before rollout date and not opted in.
  if (inst.installedAt < billingStartAt && !order.postRentalEnabledOverride) {
    return { eligible: false, reason: 'grandfathered' }
  }

  // (6) Order must actually have been completed and paid — or, on an invoice
  // account, be billed through invoices: its own invoice may still be unpaid
  // six months on, and the post is out either way.
  if (order.status !== 'completed') {
    return { eligible: false, reason: 'order_not_completed' }
  }
  if (order.paymentStatus !== 'succeeded' && order.paymentStatus !== 'pending_invoice') {
    return { eligible: false, reason: 'payment_not_succeeded' }
  }

  // Suppress now-prior reference to `now` for the "scheduled future row"
  // re-check: callers may want to know if periodStart is already in the
  // past, but that's chargesDue's job. The predicate itself is now-aware
  // only via billingStartAt; `now` is retained in the signature so the
  // cron's Pass-2 re-check can use the same predicate.
  void now
  return { eligible: true }
}
