/**
 * Post-rental billing cron.
 *
 * SCHEDULE
 *   Daily at 8am ET (13:00 UTC).
 *
 * WIRING (production)
 *   Use Railway's Cron Service plugin (or any external scheduler) to hit:
 *     GET https://<host>/api/cron/post-rental-billing
 *     Authorization: Bearer ${CRON_SECRET}
 *   A single daily run is sufficient — the unique constraint on
 *   (orderId, periodStart) means re-runs are safe.
 *
 * OPERATIONAL SWITCHES
 *   CRON_SECRET                    Required. Endpoint returns 503 if unset.
 *   POST_RENTAL_BILLING_START_AT   ISO date. Orders whose installation
 *                                  pre-dates this are grandfathered unless
 *                                  the per-order override is set. Defaults
 *                                  to 2099-01-01 → cron is DORMANT until
 *                                  Tanner flips it.
 *   ADMIN_EMAIL                    Failure alert recipient.
 *
 * QUERY PARAMS
 *   ?dry_run=true   Returns the action plan (would-fire summary) without
 *                   inserting PostRentalCharge rows OR calling Stripe.
 *
 * SEMANTICS (two-pass)
 *   Pass 1 — Scheduling: walk every eligible order, compute due-charge
 *     tuples via chargesDue(), insert any not already present. Unique
 *     constraint dedupes against prior runs.
 *   Pass 2 — Attempting: claim every scheduled row whose periodStart is
 *     in the past via atomic conditional updateMany (scheduled→attempting),
 *     then charge Stripe off-session with an idempotency key derived from
 *     (orderId, periodStart). Mark succeeded/failed accordingly; send the
 *     customer a receipt on success and an admin alert on failure (except
 *     'no_payment_method', which is too noisy to alert on every day).
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Prisma, type PostRentalChargeType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { getStripeErrorMessage } from '@/lib/stripe/server'
import { audit, AuditAction } from '@/lib/audit'
import {
  chargesDue,
  isPostRentalEligible,
  getBillingStartAt,
  type DueCharge,
} from '@/lib/post-rental-billing'
import {
  sendPostRentalChargeReceipt,
  sendAdminChargeFailureAlert,
} from '@/lib/email'

// Cron must not be statically optimized — every invocation is a fresh run.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ChargeTypeStr = DueCharge['chargeType']

interface ChargeSummaryRow {
  orderId: string
  orderNumber: string
  chargeType: ChargeTypeStr
  amountCents: number
  periodStart: string
}

interface SkippedRow {
  orderId: string
  orderNumber: string
  reason: string
}

interface CronSummary {
  scanned: number
  eligible: number
  scheduled: number
  attempted: number
  succeeded: number
  failed: number
  skipped: number
  dryRun: boolean
  billingStartAt: string
  durationMs: number
  // Detail breakdowns surface in dry-run so the operator can sanity-check.
  wouldSchedule?: ChargeSummaryRow[]
  wouldAttempt?: ChargeSummaryRow[]
  skippedDetail?: SkippedRow[]
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${secret}`
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get('dry_run') === 'true'
  const startedAt = Date.now()
  const now = new Date()
  const billingStartAt = getBillingStartAt()

  const summary: CronSummary = {
    scanned: 0, eligible: 0, scheduled: 0, attempted: 0,
    succeeded: 0, failed: 0, skipped: 0,
    dryRun,
    billingStartAt: billingStartAt.toISOString(),
    durationMs: 0,
  }
  const wouldSchedule: ChargeSummaryRow[] = []
  const wouldAttempt: ChargeSummaryRow[] = []
  const skippedDetail: SkippedRow[] = []

  try {
    // ─────────────── Pass 1: scheduling ───────────────
    // Narrow the scan to orders that COULD plausibly be rentable so we don't
    // pull every order in the DB each day.
    const orders = await prisma.order.findMany({
      where: {
        status: 'completed',
        paymentStatus: 'succeeded',
        postRentalStoppedAt: null,
        installation: { is: { status: 'active' } },
        // Defense in depth: NEVER auto-charge an invoice-billing customer's
        // card here, even if their order somehow got into paymentStatus
        // 'succeeded' (e.g. via the orders/[id] complete-charge bug). Their
        // cards may only be charged via the customer-initiated Stripe
        // Payment Link on a bundled invoice — never on a cron.
        user: { invoiceBilling: false },
      },
      include: { user: true, installation: true },
    })
    summary.scanned = orders.length

    for (const order of orders) {
      const elig = isPostRentalEligible({ order, now, billingStartAt })
      if (!elig.eligible) {
        skippedDetail.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          reason: elig.reason,
        })
        continue
      }
      summary.eligible++
      if (!order.installation) continue // narrowed by predicate, but TS guard

      const due = chargesDue(order.installation.installedAt, now)
      for (const d of due) {
        if (dryRun) {
          wouldSchedule.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            chargeType: d.chargeType,
            amountCents: d.amountCents,
            periodStart: d.periodStart.toISOString(),
          })
          continue
        }
        try {
          const created = await prisma.postRentalCharge.create({
            data: {
              orderId: order.id,
              chargeType: d.chargeType as PostRentalChargeType,
              amountCents: d.amountCents,
              periodStart: d.periodStart,
              periodEnd: d.periodEnd,
              status: 'scheduled',
            },
          })
          summary.scheduled++
          await audit({
            actor: { system: true },
            action: AuditAction.PostRentalChargeScheduled,
            targetType: 'post_rental_charge',
            targetId: created.id,
            metadata: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              chargeType: d.chargeType,
              amountCents: d.amountCents,
              periodStart: d.periodStart.toISOString(),
              periodEnd: d.periodEnd.toISOString(),
            },
          })
        } catch (err) {
          // Dupe = already scheduled on a prior run; skip silently.
          if (!isUniqueViolation(err)) throw err
        }
      }
    }

    summary.skipped = skippedDetail.length

    // ─────────────── Pass 2: attempting ───────────────
    if (!dryRun) {
      const dueRows = await prisma.postRentalCharge.findMany({
        where: { status: 'scheduled', periodStart: { lte: now } },
        include: {
          order: {
            include: { user: true, installation: true, placedBy: true },
          },
        },
      })

      for (const row of dueRows) {
        // Atomic reserve — guards against double-runners and re-checks state.
        const reserved = await prisma.postRentalCharge.updateMany({
          where: { id: row.id, status: 'scheduled' },
          data: {
            status: 'attempting',
            attemptedAt: new Date(),
            attemptCount: { increment: 1 },
          },
        })
        if (reserved.count === 0) continue
        summary.attempted++

        // Pickup-during-period cancel rule: if the rental clock has now
        // stopped AND this row's period is entirely after pickup, mark
        // skipped rather than charging.
        if (
          row.order.postRentalStoppedAt &&
          row.periodStart > row.order.postRentalStoppedAt
        ) {
          await prisma.postRentalCharge.update({
            where: { id: row.id },
            data: {
              status: 'skipped',
              failureCode: 'pickup_before_period',
              failureMessage: 'Pickup happened before this period began.',
            },
          })
          summary.skipped++
          summary.attempted--
          await audit({
            actor: { system: true },
            action: AuditAction.PostRentalChargeSkipped,
            targetType: 'post_rental_charge',
            targetId: row.id,
            metadata: { reason: 'pickup_before_period' },
          })
          continue
        }

        const payer = await resolveBillingPayer(row.order)
        const customerEmail = row.order.user.email

        // Defense in depth #2: even after the Pass-1 findMany filter, refuse
        // to call paymentIntents.create for any row whose underlying order
        // owner is on invoice billing. Catches PostRentalCharge rows that
        // were scheduled BEFORE this guard shipped (rows that already exist
        // in 'due' state for invoice-billing customers — mark them failed
        // with a clear reason instead of charging).
        if (row.order.user.invoiceBilling) {
          await markFailed(
            row.id,
            'invoice_billing',
            'Customer is on invoice billing — auto-charge not permitted; bundle on next invoice instead',
            row.attemptCount + 1,
          )
          summary.skipped++
          summary.attempted--
          continue
        }

        if (!payer || !payer.stripeCustomerId || !payer.paymentMethodId) {
          await markFailed(row.id, 'no_payment_method', 'No card on file', row.attemptCount + 1)
          summary.failed++
          // QUIET — don't spam admin daily for missing cards.
          continue
        }

        const idemKey = `post_rental:${row.orderId}:${row.periodStart.toISOString()}:v1`
        await audit({
          actor: { system: true },
          action: AuditAction.PostRentalChargeAttempt,
          targetType: 'post_rental_charge',
          targetId: row.id,
          metadata: {
            orderId: row.orderId,
            amountCents: row.amountCents,
            attemptCount: row.attemptCount + 1,
            idemKey,
          },
        })

        try {
          const pi = await stripe.paymentIntents.create({
            customer: payer.stripeCustomerId,
            payment_method: payer.paymentMethodId,
            amount: row.amountCents,
            currency: 'usd',
            off_session: true,
            confirm: true,
            description: `Post rental — Order ${row.order.orderNumber}`,
            metadata: {
              post_rental_charge_id: row.id,
              order_id: row.orderId,
              charge_type: row.chargeType,
            },
          }, { idempotencyKey: idemKey })

          if (pi.status === 'succeeded') {
            await markSucceeded(row.id, pi.id)
            summary.succeeded++

            const propertyAddress = row.order.installation
              ? `${row.order.installation.propertyAddress}, ${row.order.installation.propertyCity}, ${row.order.installation.propertyState} ${row.order.installation.propertyZip}`
              : row.order.propertyAddress
            const recipientName =
              row.order.user.fullName || row.order.user.name || row.order.user.email

            try {
              await sendPostRentalChargeReceipt({
                recipientUserId: row.order.userId,
                recipientName,
                recipientEmail: customerEmail,
                orderNumber: row.order.orderNumber,
                propertyAddress,
                amountCents: row.amountCents,
                chargeType: row.chargeType as ChargeTypeStr,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                chargedAt: new Date(),
                cardLast4: payer.cardLast4,
              })
            } catch (emailErr) {
              console.error('Post-rental receipt email failed (charge still succeeded):', emailErr)
            }
          } else {
            // E.g. requires_action — off-session can't satisfy 3DS challenge.
            await markFailed(row.id, pi.status, 'Charge did not complete', row.attemptCount + 1)
            summary.failed++
            await sendAdminChargeFailureAlert({
              orderNumber: row.order.orderNumber,
              orderId: row.orderId,
              customerEmail,
              amountCents: row.amountCents,
              failureCode: pi.status,
              failureMessage: 'Charge did not complete (likely needs 3DS authentication)',
              attemptCount: row.attemptCount + 1,
              escalate: row.attemptCount + 1 >= 7,
            }).catch((e) => console.error('admin alert failed:', e))
          }
        } catch (err) {
          const { code, message } = parseStripeError(err)
          await markFailed(row.id, code, message, row.attemptCount + 1)
          summary.failed++
          if (code !== 'no_payment_method') {
            await sendAdminChargeFailureAlert({
              orderNumber: row.order.orderNumber,
              orderId: row.orderId,
              customerEmail,
              amountCents: row.amountCents,
              failureCode: code,
              failureMessage: message,
              attemptCount: row.attemptCount + 1,
              escalate: row.attemptCount + 1 >= 7,
            }).catch((e) => console.error('admin alert failed:', e))
          }
        }
      }
    } else {
      // Dry-run preview of Pass 2 — count what WOULD have been attempted
      // including newly scheduled (in-memory) plus already-due existing rows.
      const existingDue = await prisma.postRentalCharge.findMany({
        where: { status: 'scheduled', periodStart: { lte: now } },
        select: {
          id: true, orderId: true, chargeType: true, amountCents: true,
          periodStart: true,
          order: { select: { orderNumber: true } },
        },
      })
      for (const r of existingDue) {
        wouldAttempt.push({
          orderId: r.orderId,
          orderNumber: r.order.orderNumber,
          chargeType: r.chargeType as ChargeTypeStr,
          amountCents: r.amountCents,
          periodStart: r.periodStart.toISOString(),
        })
      }
      // Newly scheduled (in-memory) rows whose periodStart <= now would also fire.
      for (const w of wouldSchedule) {
        if (new Date(w.periodStart) <= now) wouldAttempt.push(w)
      }
      summary.scheduled = wouldSchedule.length
      summary.attempted = wouldAttempt.length
    }

    summary.durationMs = Date.now() - startedAt
    if (dryRun) {
      summary.wouldSchedule = wouldSchedule
      summary.wouldAttempt = wouldAttempt
      summary.skippedDetail = skippedDetail
    }
    return NextResponse.json(summary)
  } catch (err) {
    console.error('Post-rental billing cron failed:', err)
    summary.durationMs = Date.now() - startedAt
    return NextResponse.json(
      { error: 'cron failed', message: err instanceof Error ? err.message : String(err), summary },
      { status: 500 },
    )
  }
}

// ─────────────────────── helpers ───────────────────────

async function markSucceeded(id: string, piId: string) {
  await prisma.postRentalCharge.update({
    where: { id },
    data: {
      status: 'succeeded',
      stripePaymentIntentId: piId,
      succeededAt: new Date(),
      failureCode: null,
      failureMessage: null,
    },
  })
  await audit({
    actor: { system: true },
    action: AuditAction.PostRentalChargeSucceeded,
    targetType: 'post_rental_charge',
    targetId: id,
    metadata: { stripePaymentIntentId: piId },
  })
}

async function markFailed(
  id: string,
  code: string,
  message: string,
  attemptCount: number,
) {
  await prisma.postRentalCharge.update({
    where: { id },
    data: {
      status: 'failed',
      failureCode: code,
      failureMessage: message,
    },
  })
  await audit({
    actor: { system: true },
    action: AuditAction.PostRentalChargeFailed,
    targetType: 'post_rental_charge',
    targetId: id,
    metadata: { failureCode: code, failureMessage: message, attemptCount },
  })
}

function parseStripeError(err: unknown): { code: string; message: string } {
  if (err instanceof Stripe.errors.StripeCardError) {
    return {
      code: err.decline_code || err.code || 'card_error',
      message: getStripeErrorMessage(err) || err.message || 'Card error',
    }
  }
  if (err instanceof Stripe.errors.StripeError) {
    return {
      code: err.code || err.type || 'stripe_error',
      message: getStripeErrorMessage(err) || err.message || 'Stripe error',
    }
  }
  return {
    code: 'unknown_error',
    message: err instanceof Error ? err.message : String(err),
  }
}

// Detect Postgres unique-violation across the shapes Prisma 7's adapter-pg
// surfaces — mirrors the helper in lib/inventory-holds.ts.
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return true
    if (err.code === 'P2010') {
      const msg = String(err.message || '')
      if (msg.includes('UniqueConstraintViolation') || msg.includes('23505')) return true
    }
  }
  const anyErr = err as { code?: string; cause?: { name?: string }; message?: string } | null
  if (anyErr?.code === '23505') return true
  if (anyErr?.cause?.name === 'UniqueConstraintViolation') return true
  return false
}

interface OrderForPayer {
  id: string
  userId: string
  placedByUserId: string | null
  user: { id: string; stripeCustomerId: string | null }
  placedBy: { id: string; stripeCustomerId: string | null } | null
}

interface BillingPayer {
  userId: string
  stripeCustomerId: string
  paymentMethodId: string | null
  cardLast4: string | null
}

/**
 * Resolve who Stripe should charge for this order's post rental. Mirrors the
 * payer ladder from refund-recipient: team_admin who placed it → order owner
 * (if team_admin themselves) → team_admin of the agent's team → order owner.
 * Returns null only if no usable Stripe customer + card combo exists anywhere.
 */
async function resolveBillingPayer(order: OrderForPayer): Promise<BillingPayer | null> {
  // Build the candidate ladder.
  const candidateIds: string[] = []
  if (order.placedByUserId) candidateIds.push(order.placedByUserId)
  candidateIds.push(order.userId)

  for (const candidateId of candidateIds) {
    const user = await prisma.user.findUnique({
      where: { id: candidateId },
      select: { id: true, stripeCustomerId: true, teamId: true, role: true },
    })
    if (!user) continue
    if (!user.stripeCustomerId) continue
    const pm =
      (await prisma.paymentMethod.findFirst({ where: { userId: user.id, isDefault: true } })) ||
      (await prisma.paymentMethod.findFirst({ where: { userId: user.id } }))
    if (!pm) continue
    return {
      userId: user.id,
      stripeCustomerId: user.stripeCustomerId,
      paymentMethodId: pm.stripePaymentMethodId,
      cardLast4: pm.last4 ?? null,
    }
  }

  // Final fallback: walk to the agent's team_admin if the order owner is on a team.
  const owner = await prisma.user.findUnique({
    where: { id: order.userId },
    select: { teamId: true, role: true },
  })
  if (owner?.teamId && owner.role !== 'team_admin') {
    const teamAdmin = await prisma.user.findFirst({
      where: { teamId: owner.teamId, role: 'team_admin' },
      select: { id: true, stripeCustomerId: true },
      orderBy: { createdAt: 'asc' },
    })
    if (teamAdmin?.stripeCustomerId) {
      const pm =
        (await prisma.paymentMethod.findFirst({ where: { userId: teamAdmin.id, isDefault: true } })) ||
        (await prisma.paymentMethod.findFirst({ where: { userId: teamAdmin.id } }))
      if (pm) {
        return {
          userId: teamAdmin.id,
          stripeCustomerId: teamAdmin.stripeCustomerId,
          paymentMethodId: pm.stripePaymentMethodId,
          cardLast4: pm.last4 ?? null,
        }
      }
    }
  }

  return null
}
