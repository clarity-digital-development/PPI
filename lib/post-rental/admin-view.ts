// Admin-view aggregator for the /admin/orders/[id] PostRental card. Pure
// function — takes already-loaded order/installation/user/charges and the
// current Date, returns the section-8 response shape. Owned by Specialist C
// (admin visibility); does NOT do DB I/O so it's safe to call from any route.
//
// Next-charge math here is intentionally inline-duplicated from Specialist B's
// chargesDue helper so the admin card has zero coupling to cron internals.
// If the schedule policy changes, BOTH paths must be updated together — keep
// in sync with `lib/post-rental/charges-due.ts`.

import type { PostRentalCharge } from '@prisma/client'

type OrderForView = {
  id: string
  status: string
  paymentStatus: string
  postRentalEnabledOverride: boolean
  postRentalDisabled: boolean
  postRentalStoppedAt: Date | null
}

type InstallationForView = {
  installedAt: Date
  status: string
  removalDate: Date | null
  removedAt: Date | null
} | null

type UserForView = {
  role: string
  isServiceAreaExempt: boolean
}

export type PostRentalViewStatus =
  | 'active'
  | 'grandfathered'
  | 'stopped'
  | 'disabled'
  | 'exempt'
  | 'never_eligible'

export interface NextChargePreview {
  dueDate: string
  chargeType: 'six_month' | 'nine_month' | 'monthly'
  amountCents: number
}

export interface PostRentalChargeRow {
  id: string
  chargeType: string
  amountCents: number
  periodStart: string
  periodEnd: string
  status: string
  attemptedAt: string | null
  succeededAt: string | null
  failureCode: string | null
  failureMessage: string | null
  stripePaymentIntentId: string | null
  attemptCount: number
}

export interface PostRentalView {
  status: PostRentalViewStatus
  reason?: string
  installedAt: string | null
  stoppedAt: string | null
  override: boolean
  nextCharge: NextChargePreview | null
  history: PostRentalChargeRow[]
}

// Calendar-month addition that mirrors date-fns/addMonths semantics: preserves
// the day-of-month when possible, clamps to month-end on shorter months.
function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  const target = new Date(Date.UTC(y, m + months, 1))
  const daysInTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(d, daysInTargetMonth)
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
}

// Returns every (chargeType, periodStart, periodEnd, amountCents) tuple whose
// periodStart is in the future relative to `now`. Caller filters against
// already-scheduled rows to pick the earliest UNscheduled one.
function futureChargeAnchors(installedAt: Date, now: Date): NextChargePreview[] {
  const anchors: NextChargePreview[] = []
  const sixMonth = addMonths(installedAt, 6)
  if (sixMonth > now) {
    anchors.push({ dueDate: sixMonth.toISOString(), chargeType: 'six_month', amountCents: 1800 })
  }
  const nineMonth = addMonths(installedAt, 9)
  if (nineMonth > now) {
    anchors.push({ dueDate: nineMonth.toISOString(), chargeType: 'nine_month', amountCents: 1800 })
  }
  // Monthly anchors from month 12 forward — surface the next ~12 so the admin
  // card can pick the first unscheduled one without surprising long gaps.
  for (let k = 0; k < 24; k++) {
    const anchor = addMonths(installedAt, 12 + k)
    if (anchor > now) {
      anchors.push({ dueDate: anchor.toISOString(), chargeType: 'monthly', amountCents: 600 })
    }
  }
  return anchors.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export function computePostRentalView(args: {
  order: OrderForView
  installation: InstallationForView
  user: UserForView
  charges: PostRentalCharge[]
  now: Date
}): PostRentalView {
  const { order, installation, user, charges, now } = args

  const history: PostRentalChargeRow[] = charges.map((c) => ({
    id: c.id,
    chargeType: c.chargeType,
    amountCents: c.amountCents,
    periodStart: c.periodStart.toISOString(),
    periodEnd: c.periodEnd.toISOString(),
    status: c.status,
    attemptedAt: c.attemptedAt ? c.attemptedAt.toISOString() : null,
    succeededAt: c.succeededAt ? c.succeededAt.toISOString() : null,
    failureCode: c.failureCode,
    failureMessage: c.failureMessage,
    stripePaymentIntentId: c.stripePaymentIntentId,
    attemptCount: c.attemptCount,
  }))

  const installedAt = installation ? installation.installedAt.toISOString() : null
  const stoppedAt = order.postRentalStoppedAt ? order.postRentalStoppedAt.toISOString() : null
  const override = order.postRentalEnabledOverride

  // CR2: admin manually disabled post-rental for this order (e.g. customer-owned
  // post). Authoritative — surfaced before everything else.
  if (order.postRentalDisabled) {
    return {
      status: 'disabled',
      reason: 'Post-rental billing disabled for this order (e.g. customer-owned post)',
      installedAt,
      stoppedAt,
      override,
      nextCharge: null,
      history,
    }
  }

  // Status resolution mirrors the eligibility predicate ladder so admin sees
  // the same answer the cron would.
  if (user.role === 'admin' || user.role === 'team_admin' || user.isServiceAreaExempt) {
    return {
      status: 'exempt',
      reason: user.role === 'team_admin' ? 'Broker account (team_admin)' : user.role === 'admin' ? 'Internal staff account' : 'Per-customer exemption',
      installedAt,
      stoppedAt,
      override,
      nextCharge: null,
      history,
    }
  }

  if (!installation || installation.status !== 'active') {
    return {
      status: 'never_eligible',
      reason: !installation ? 'No installation on file' : `Installation is ${installation.status}`,
      installedAt,
      stoppedAt,
      override,
      nextCharge: null,
      history,
    }
  }

  if (order.postRentalStoppedAt) {
    return {
      status: 'stopped',
      reason: 'Pickup scheduled or completed',
      installedAt,
      stoppedAt,
      override,
      nextCharge: null,
      history,
    }
  }

  if (order.status !== 'completed' || order.paymentStatus !== 'succeeded') {
    return {
      status: 'never_eligible',
      reason: `Order status is ${order.status} / payment ${order.paymentStatus}`,
      installedAt,
      stoppedAt,
      override,
      nextCharge: null,
      history,
    }
  }

  // Grandfathered: installed before billing rollout AND no per-order override.
  // We don't read POST_RENTAL_BILLING_START_AT here because the admin view
  // shouldn't depend on a runtime env read; the cron is the gate. Surface
  // override-on installations as 'active' and pristine pre-rollout ones as
  // 'grandfathered' so the admin can see whether the toggle is doing work.
  const billingStartAt = parseBillingStartAt()
  const isPreRollout = installation.installedAt < billingStartAt
  if (isPreRollout && !order.postRentalEnabledOverride) {
    return {
      status: 'grandfathered',
      reason: `Installed before billing rollout (${billingStartAt.toISOString().slice(0, 10)})`,
      installedAt,
      stoppedAt,
      override,
      nextCharge: null,
      history,
    }
  }

  // Active path — compute next-charge preview by walking anchors and skipping
  // ones we've already scheduled (matches by periodStart millis-equal).
  const scheduledStartsMs = new Set(charges.map((c) => c.periodStart.getTime()))
  const anchors = futureChargeAnchors(installation.installedAt, now)
  const nextCharge = anchors.find((a) => !scheduledStartsMs.has(new Date(a.dueDate).getTime())) ?? null

  return {
    status: 'active',
    reason: order.postRentalEnabledOverride && isPreRollout ? 'Admin opt-in (per-order override)' : undefined,
    installedAt,
    stoppedAt,
    override,
    nextCharge,
    history,
  }
}

// Defensive env read with the far-future default the spec mandates.
function parseBillingStartAt(): Date {
  const raw = process.env.POST_RENTAL_BILLING_START_AT
  if (!raw) return new Date('2099-01-01T00:00:00Z')
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return new Date('2099-01-01T00:00:00Z')
  return parsed
}
