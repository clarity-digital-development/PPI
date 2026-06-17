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
  | 'pickup_before_6mo'
  | 'pickup_scheduled'
  | 'exempt_role_admin'
  | 'exempt_role_team_admin'
  | 'exempt_per_customer'
  | 'exempt_invoice_billing'
  | 'grandfathered'
  | 'order_not_completed'
  | 'payment_not_succeeded'

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityReason }

export interface EligibilityInput {
  order: Order & { user: User; installation: Installation | null }
  now: Date
  billingStartAt: Date
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

  // (4) Exemptions — admins, brokers, per-customer overrides skip rental.
  if (order.user.role === 'admin') {
    return { eligible: false, reason: 'exempt_role_admin' }
  }
  if (order.user.role === 'team_admin') {
    return { eligible: false, reason: 'exempt_role_team_admin' }
  }
  if (order.user.isServiceAreaExempt) {
    return { eligible: false, reason: 'exempt_per_customer' }
  }
  // Invoice-billing customers' cards are never auto-charged anywhere in
  // the system — post-rental fees included. Any rental owed by an
  // invoice-billing customer must be added to a bundled invoice manually
  // (admin SR invoice flow / broker self-serve / admin order edit).
  if (order.user.invoiceBilling) {
    return { eligible: false, reason: 'exempt_invoice_billing' }
  }

  // (5) Grandfathered — installed before rollout date and not opted in.
  if (inst.installedAt < billingStartAt && !order.postRentalEnabledOverride) {
    return { eligible: false, reason: 'grandfathered' }
  }

  // (6) Order must actually have been completed and paid.
  if (order.status !== 'completed') {
    return { eligible: false, reason: 'order_not_completed' }
  }
  if (order.paymentStatus !== 'succeeded') {
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
