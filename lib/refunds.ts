import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { refundPaymentIntent, findOrderRefund, getStripeErrorMessage } from '@/lib/stripe/server'
import { releaseOrderHoldsAndRestoreInventory } from '@/lib/inventory-holds'
import { resolveRefundRecipient } from '@/lib/orders/refund-recipient'
import { sendRefundConfirmationEmail } from '@/lib/email'
import { audit, AuditAction, type AuditActor } from '@/lib/audit'

/**
 * Threshold above which a customer cancel requires a second-confirmation
 * click in the modal. Customer-initiated only — admin path bypasses.
 *
 * Locked decision (2026-06-02): under $250 auto-execute; >= $250
 * requires explicit confirmation.
 */
export const CLICK_THROUGH_THRESHOLD_DOLLARS = 250
export const CLICK_THROUGH_THRESHOLD_CENTS = CLICK_THROUGH_THRESHOLD_DOLLARS * 100

export type CancelReason = 'customer_cancel' | 'admin_cancel' | 'stripe_dashboard'

export interface RefundOrderOptions {
  reason: CancelReason
  /** Free-text reason supplied by the customer (optional, max 500 chars). */
  customerReason?: string | null
  actor: AuditActor
  request?: NextRequest | Request | null
  /**
   * True if the customer's order was under the click-through threshold
   * (frictionless one-click). False if it required a double-confirm OR
   * was initiated by admin / Stripe-dashboard. Surfaces in the audit
   * metadata + email body copy.
   */
  auto: boolean
  /** Webhook path sets true when it has already sent the email. */
  skipEmail?: boolean
  /**
   * Admin partial refund, in cents. Omit for a full refund. The route
   * validates 0 < amountCents < the order total and that the order is the
   * only one on its PaymentIntent (a partial on a shared charge can't be
   * attributed to one order by the charge.refunded webhook).
   */
  amountCents?: number
}

export type RefundOrderResult =
  | { ok: true; refundId: string; amountCents: number; emailed: boolean }
  | { ok: false; error: string; code: 'STRIPE_ERROR' | 'NOT_REFUNDABLE' | 'ALREADY_REFUNDED' }

export interface CancelUnpaidOrderOptions {
  reason: CancelReason
  customerReason?: string | null
  actor: AuditActor
  request?: NextRequest | Request | null
}

export type CancelUnpaidOrderResult =
  | { ok: true }
  | { ok: false; error: string; code: 'NOT_CANCELLABLE' | 'ALREADY_CANCELLED' | 'ALREADY_INVOICED' }

/**
 * Full-refund-and-cancel orchestration. Pure server-side: no auth, no
 * threshold check — those are the route handler's job.
 *
 * Concurrency model (R1/R2/R5 from refund-verify-punchlist):
 *
 *   Step 0 — RESERVE: conditional updateMany sets refundInitiatedAt + actor
 *   metadata atomically. Only one caller wins; the rest get ALREADY_REFUNDED
 *   without ever touching Stripe. This makes the DB row the lock — closes
 *   the customer/admin race, the double-click race, AND the webhook
 *   misclassification race (charge.refunded webhook now checks
 *   refundInitiatedAt to know "refundOrder is in charge here").
 *
 *   Step 1 — Load fresh + final eligibility (paymentIntentId etc.)
 *   Step 2 — Stripe refunds.create (idempotent via SHA-256 of orderId)
 *   Step 3 — Stamp refundId + status='cancelled' + cancelledAt + refundReason
 *   Step 4 — Audit OrderRefundCreate
 *   Step 5 — Inventory restore (helper idempotent + self-auditing)
 *   Step 6 — Audit OrderCancel
 *   Step 7 — Reserve refundEmailSentAt via conditional update; if our
 *            reserve wins, send the email. Webhook does the same reserve;
 *            whichever fires first sends, the other becomes a no-op.
 *
 * paymentStatus is NOT flipped to 'refunded' here — the charge.refunded
 * webhook owns that transition (single source of truth across explicit
 * + dashboard-initiated refunds).
 */
export async function refundOrder(
  orderId: string,
  options: RefundOrderOptions
): Promise<RefundOrderResult> {
  const actorId = options.actor && 'id' in options.actor ? options.actor.id : null

  // Pre-reserve snapshot of the columns Step 0 overwrites, so a refund that
  // Stripe definitively rejects can be rolled back to exactly this state
  // (e.g. an order an admin had already cancelled without a refund keeps
  // its original cancel attribution).
  const preReserve = await prisma.order.findUnique({
    where: { id: orderId },
    select: { cancelReason: true, cancelledByUserId: true, refundReason: true, paymentIntentId: true },
  })

  // A cart checkout charges several orders in ONE PaymentIntent, and Step 2
  // refunds a PI in full — so refunding one cart order here refunded every
  // order in the cart (and the webhook then cancelled or zeroed the others).
  // Same hazard as the invoiceId exclusion below; covers the customer
  // self-cancel path too. Those are refunded by hand in Stripe instead.
  if (preReserve?.paymentIntentId) {
    const onCharge = await prisma.order.count({ where: { paymentIntentId: preReserve.paymentIntentId } })
    if (onCharge > 1) {
      return {
        ok: false,
        error: 'This order was paid together with other orders in one payment, so it can\'t be refunded on its own here. Contact Pink Posts to cancel it.',
        code: 'NOT_REFUNDABLE',
      }
    }
  }

  // ── Step 0: RESERVE the refund slot via conditional update ──
  // updateMany returns count > 0 only if a row matched the WHERE; this
  // turns the read-then-write window into one atomic DB operation.
  const reserved = await prisma.order.updateMany({
    where: {
      id: orderId,
      refundInitiatedAt: null,
      refundId: null,
      paymentStatus: 'succeeded',
      // No PI (e.g. a $0 order) = nothing to refund. Without this the
      // reserve stamped refundInitiatedAt and Step 1 bailed, leaving the
      // order stuck as "refund processing" forever.
      paymentIntentId: { not: null },
      // An order paid through a bundled invoice carries the INVOICE's PI (the
      // webhook stamps it on every order it settles), and Step 2 refunds a PI
      // in full — so refunding one order here refunded every order, service
      // trip and pickup on that invoice. Those are refunded by hand in Stripe
      // for the order's amount instead.
      invoiceId: null,
    },
    data: {
      refundInitiatedAt: new Date(),
      cancelReason: options.reason,
      cancelledByUserId: actorId,
      refundReason: options.customerReason ?? null,
    },
  })
  if (reserved.count === 0) {
    // Lost the race. Distinguish "already refunded" from other reasons via
    // a follow-up read so the caller can render a useful message.
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, paymentStatus: true, refundId: true, refundInitiatedAt: true, paymentIntentId: true, invoiceId: true },
    })
    if (!existing) return { ok: false, error: 'Order not found', code: 'NOT_REFUNDABLE' }
    if (existing.refundId || existing.refundInitiatedAt) {
      return { ok: false, error: 'Order already refunded', code: 'ALREADY_REFUNDED' }
    }
    if (existing.invoiceId) {
      return {
        ok: false,
        error: "This order was paid on an invoice — refunding it here would refund the whole invoice. Refund the order's amount by hand instead: a partial refund of the invoice's payment in Stripe, or outside Stripe if the invoice was marked paid manually.",
        code: 'NOT_REFUNDABLE',
      }
    }
    if (existing.paymentStatus !== 'succeeded') {
      return { ok: false, error: 'Order is not in a refundable state', code: 'NOT_REFUNDABLE' }
    }
    if (!existing.paymentIntentId) {
      return { ok: false, error: 'Order has no payment to refund', code: 'NOT_REFUNDABLE' }
    }
    return { ok: false, error: 'Order is not in a refundable state', code: 'NOT_REFUNDABLE' }
  }

  // ── Step 1: load fresh order (now that we own the slot) ──
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, orderItems: true },
  })
  if (!order || !order.paymentIntentId) {
    // Belt-and-suspenders: the reserve requires a paymentIntentId, but if
    // we ever get here release the reservation so the order isn't stuck.
    await prisma.order.updateMany({
      where: { id: orderId, refundId: null },
      data: {
        refundInitiatedAt: null,
        cancelReason: preReserve?.cancelReason ?? null,
        cancelledByUserId: preReserve?.cancelledByUserId ?? null,
        refundReason: preReserve?.refundReason ?? null,
      },
    })
    return { ok: false, error: 'Order has no payment to refund', code: 'NOT_REFUNDABLE' }
  }

  // ── Step 2: Stripe refund (idempotent via deterministic key) ──
  // Metadata kept minimal: order_id only. The cancel_reason and actor_user_id
  // live in our audit log — including them in Stripe metadata caused R3
  // (key+different-params collision returns 400 on a concurrent retry).
  let refundId: string
  let refundAmountCents: number
  try {
    const result = await refundPaymentIntent({
      paymentIntentId: order.paymentIntentId,
      orderId: order.id,
      reason: 'requested_by_customer',
      ...(options.amountCents !== undefined ? { amountCents: options.amountCents } : {}),
    })
    refundId = result.refundId
    refundAmountCents = result.amount
  } catch (err) {
    const message = getStripeErrorMessage(err) ?? String(err)
    // Before releasing the reservation, make sure Stripe really didn't make
    // the refund (a lost response on a refund that went through must NOT
    // be retried — that would refund twice). Without this, the reservation
    // stayed set forever after any failure: the order showed "Refund
    // processing" indefinitely and every retry answered "already refunded".
    let existing: Awaited<ReturnType<typeof findOrderRefund>> | undefined
    try {
      existing = await findOrderRefund(order.paymentIntentId, order.id)
    } catch {
      existing = undefined // couldn't reach Stripe — state unknown
    }

    if (existing) {
      refundId = existing.id
      refundAmountCents = existing.amount
    } else {
      if (existing === null) {
        // Stripe confirms no refund exists for this order: release the
        // reservation so the admin can retry, restoring the pre-reserve
        // cancel attribution.
        await prisma.order.updateMany({
          where: { id: order.id, refundId: null },
          data: {
            refundInitiatedAt: null,
            cancelReason: preReserve?.cancelReason ?? null,
            cancelledByUserId: preReserve?.cancelledByUserId ?? null,
            refundReason: preReserve?.refundReason ?? null,
          },
        })
      }
      await audit({
        actor: options.actor,
        action: AuditAction.OrderRefundFail,
        targetType: 'order',
        targetId: order.id,
        metadata: {
          reason: options.reason,
          error: message,
          amountCents: options.amountCents ?? null,
          released: existing === null,
        },
        request: options.request,
      })
      return {
        ok: false,
        error:
          existing === null
            ? getStripeErrorMessage(err) ?? 'Refund failed'
            : "Couldn't confirm the refund with Stripe. Check the payment in Stripe before trying again.",
        code: 'STRIPE_ERROR',
      }
    }
  }

  // ── Step 3: stamp refundId + cancellation. Step 0 reserved us; no race. ──
  // A partial refund also stamps refundedAmount now: the charge.refunded
  // webhook never flips a partial to paymentStatus='refunded', and both the
  // customer's "refund processing" line and the revenue stats read this
  // column to show/subtract the right amount.
  await prisma.order.update({
    where: { id: order.id },
    data: {
      refundId,
      status: 'cancelled',
      // Keep the original cancel time when refunding an order that was
      // already cancelled without a refund.
      cancelledAt: order.cancelledAt ?? new Date(),
      ...(options.amountCents !== undefined ? { refundedAmount: refundAmountCents / 100 } : {}),
    },
  })

  // ── Step 4: refund-create audit ──
  await audit({
    actor: options.actor,
    action: AuditAction.OrderRefundCreate,
    targetType: 'order',
    targetId: order.id,
    metadata: {
      refundId,
      amountCents: refundAmountCents,
      partial: options.amountCents !== undefined,
      reason: options.reason,
      auto: options.auto,
    },
    request: options.request,
  })

  // ── Step 5: inventory restore (best-effort, idempotent helper) ──
  try {
    await releaseOrderHoldsAndRestoreInventory(order.id, options.reason, options.actor, options.request)
  } catch (err) {
    console.error(`[refundOrder] inventory restore failed for ${order.id}:`, err)
  }

  // ── Step 6: order-cancel audit ──
  await audit({
    actor: options.actor,
    action: AuditAction.OrderCancel,
    targetType: 'order',
    targetId: order.id,
    metadata: { reason: options.reason, refundId, refunded: true },
    request: options.request,
  })

  // ── Step 7: reserve email slot + send ──
  // Reserve via conditional update before sending so a concurrent webhook
  // can't double-send. If reserve fails, webhook already sent (or will);
  // we no-op the email here.
  let emailed = false
  if (!options.skipEmail) {
    const emailReserved = await prisma.order.updateMany({
      where: { id: order.id, refundEmailSentAt: null },
      data: { refundEmailSentAt: new Date() },
    })
    if (emailReserved.count > 0) {
      try {
        const recipient = await resolveRefundRecipient(order)
        const propertyAddress = `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`
        await sendRefundConfirmationEmail({
          recipientName: recipient.fullName,
          recipientEmail: recipient.email,
          orderNumber: order.orderNumber,
          propertyAddress,
          refundAmount: refundAmountCents / 100,
          refundReason: options.customerReason ?? undefined,
          refundedAt: new Date(),
          refundedBy: options.reason === 'customer_cancel' ? 'customer' : 'admin',
          auto: options.auto,
          // Pref gate — refund email is treated as order-confirmation traffic.
          recipientUserId: recipient.id,
        })
        emailed = true
      } catch (err) {
        console.error(`[refundOrder] email send failed for ${order.id}:`, err)
        // Roll back the reservation so an operator (or a retry) can re-send.
        await prisma.order.updateMany({
          where: { id: order.id, refundEmailSentAt: { not: null } },
          data: { refundEmailSentAt: null },
        })
        await audit({
          actor: options.actor,
          action: AuditAction.OrderRefundFail,
          targetType: 'order',
          targetId: order.id,
          metadata: { stage: 'email', error: err instanceof Error ? err.message : String(err) },
          request: options.request,
        })
      }
    }
  }

  return { ok: true, refundId, amountCents: refundAmountCents, emailed }
}

/**
 * Cancel an invoice-billing order that hasn't been charged yet
 * (paymentStatus='pending_invoice' — no Stripe payment exists to refund).
 * Sibling to refundOrder above but with no Stripe step: just a race-safe
 * status flip, inventory restore, and audit log.
 *
 * paymentStatus is stamped 'failed' (not left as 'pending_invoice') because
 * the invoice-bundle route (app/api/invoices/bundle) selects orders purely
 * by paymentStatus='pending_invoice' — it doesn't look at order.status at
 * all, so a cancelled order left at 'pending_invoice' would still get swept
 * into a future bundled invoice. Mirrors the admin unpaid-order cancel route
 * (app/api/admin/orders/[id]/cancel), which does the same for consistency.
 *
 * invoiceId MUST be null — once an admin has bundled this order into an
 * Invoice (POST /api/invoices/bundle), the Invoice's total and its Stripe
 * Payment Link amount are frozen at bundle time and never recomputed. Same
 * hazard the edit route already guards against (app/api/orders/[id]/edit,
 * "order already invoiced" check) — cancelling a bundled order would leave
 * it invisible/free-looking to the customer while the invoice still bills
 * for it, and the Stripe webhook that marks an invoice paid flips every one
 * of its orders' paymentStatus back to 'succeeded' with no status check,
 * silently reviving the "cancelled" order.
 */
export async function cancelUnpaidOrder(
  orderId: string,
  options: CancelUnpaidOrderOptions
): Promise<CancelUnpaidOrderResult> {
  const actorId = options.actor && 'id' in options.actor ? options.actor.id : null

  // Single atomic conditional update — the WHERE clause both claims the
  // cancel and performs it, so there's no reserve-then-act window to race
  // (no external API call sits in between, unlike refundOrder's Stripe step).
  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      paymentStatus: 'pending_invoice',
      invoiceId: null,
      status: { notIn: ['in_progress', 'completed', 'cancelled'] },
    },
    data: {
      status: 'cancelled',
      paymentStatus: 'failed',
      cancelledAt: new Date(),
      cancelReason: options.reason,
      cancelledByUserId: actorId,
      refundReason: options.customerReason ?? null,
    },
  })

  if (claimed.count === 0) {
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, paymentStatus: true, invoiceId: true },
    })
    if (!existing) return { ok: false, error: 'Order not found', code: 'NOT_CANCELLABLE' }
    if (existing.status === 'cancelled') {
      return { ok: false, error: 'Order already cancelled', code: 'ALREADY_CANCELLED' }
    }
    if (existing.invoiceId) {
      return {
        ok: false,
        error: 'This order has already been invoiced; contact support to cancel',
        code: 'ALREADY_INVOICED',
      }
    }
    return { ok: false, error: 'Order is not in a cancellable state', code: 'NOT_CANCELLABLE' }
  }

  try {
    await releaseOrderHoldsAndRestoreInventory(orderId, options.reason, options.actor, options.request)
  } catch (err) {
    console.error(`[cancelUnpaidOrder] inventory restore failed for ${orderId}:`, err)
  }

  await audit({
    actor: options.actor,
    action: AuditAction.OrderCancel,
    targetType: 'order',
    targetId: orderId,
    metadata: { reason: options.reason, refunded: false, paymentStatus: 'pending_invoice' },
    request: options.request,
  })

  return { ok: true }
}

export interface CancelPaidOrderOptions {
  /** Internal note from the admin (optional, max 500 chars). */
  note?: string | null
  actor: AuditActor
  request?: NextRequest | Request | null
}

export type CancelPaidOrderResult =
  | { ok: true }
  | { ok: false; error: string; code: 'NOT_CANCELLABLE' | 'ALREADY_CANCELLED' | 'ALREADY_REFUNDED' }

/**
 * Admin: cancel a PAID order and keep the payment (no refund). The
 * deliberate version of what the status dropdown used to do silently —
 * now stamped with who/when/why, audited, and with inventory released.
 *
 * paymentStatus stays 'succeeded' (the money was kept). Leaves refundId /
 * refundInitiatedAt null, so the order can still be refunded later from
 * the admin Refund button if the admin changes their mind.
 */
export async function cancelPaidOrderWithoutRefund(
  orderId: string,
  options: CancelPaidOrderOptions
): Promise<CancelPaidOrderResult> {
  const actorId = options.actor && 'id' in options.actor ? options.actor.id : null

  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      paymentStatus: 'succeeded',
      status: { not: 'cancelled' },
      refundId: null,
      refundInitiatedAt: null,
    },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: 'admin_cancel',
      cancelledByUserId: actorId,
      refundReason: options.note ?? null,
    },
  })

  if (claimed.count === 0) {
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, paymentStatus: true, refundId: true, refundInitiatedAt: true },
    })
    if (!existing) return { ok: false, error: 'Order not found', code: 'NOT_CANCELLABLE' }
    if (existing.refundId || existing.refundInitiatedAt) {
      return { ok: false, error: 'Order already refunded', code: 'ALREADY_REFUNDED' }
    }
    if (existing.status === 'cancelled') {
      return { ok: false, error: 'Order already cancelled', code: 'ALREADY_CANCELLED' }
    }
    return { ok: false, error: 'Only paid orders can be cancelled this way', code: 'NOT_CANCELLABLE' }
  }

  try {
    await releaseOrderHoldsAndRestoreInventory(orderId, 'admin_cancel', options.actor, options.request)
  } catch (err) {
    console.error(`[cancelPaidOrderWithoutRefund] inventory restore failed for ${orderId}:`, err)
  }

  await audit({
    actor: options.actor,
    action: AuditAction.OrderCancel,
    targetType: 'order',
    targetId: orderId,
    metadata: { reason: 'admin_cancel', refunded: false, paid: true, note: options.note ?? null },
    request: options.request,
  })

  return { ok: true }
}
