import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { refundPaymentIntent, getStripeErrorMessage } from '@/lib/stripe/server'
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
}

export type RefundOrderResult =
  | { ok: true; refundId: string; amountCents: number; emailed: boolean }
  | { ok: false; error: string; code: 'STRIPE_ERROR' | 'NOT_REFUNDABLE' | 'ALREADY_REFUNDED' }

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

  // ── Step 0: RESERVE the refund slot via conditional update ──
  // updateMany returns count > 0 only if a row matched the WHERE; this
  // turns the read-then-write window into one atomic DB operation.
  const reserved = await prisma.order.updateMany({
    where: {
      id: orderId,
      refundInitiatedAt: null,
      refundId: null,
      paymentStatus: 'succeeded',
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
      select: { id: true, paymentStatus: true, refundId: true, refundInitiatedAt: true, paymentIntentId: true },
    })
    if (!existing) return { ok: false, error: 'Order not found', code: 'NOT_REFUNDABLE' }
    if (existing.refundId || existing.refundInitiatedAt) {
      return { ok: false, error: 'Order already refunded', code: 'ALREADY_REFUNDED' }
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
    // Belt-and-suspenders: the reserve only matches paymentStatus='succeeded'
    // which implies paymentIntentId is set, but defend anyway.
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
    })
    refundId = result.refundId
    refundAmountCents = result.amount
  } catch (err) {
    await audit({
      actor: options.actor,
      action: AuditAction.OrderRefundFail,
      targetType: 'order',
      targetId: order.id,
      metadata: { reason: options.reason, error: getStripeErrorMessage(err) ?? String(err) },
      request: options.request,
    })
    return { ok: false, error: getStripeErrorMessage(err) ?? 'Refund failed', code: 'STRIPE_ERROR' }
  }

  // ── Step 3: stamp refundId + cancellation. Step 0 reserved us; no race. ──
  await prisma.order.update({
    where: { id: order.id },
    data: {
      refundId,
      status: 'cancelled',
      cancelledAt: new Date(),
    },
  })

  // ── Step 4: refund-create audit ──
  await audit({
    actor: options.actor,
    action: AuditAction.OrderRefundCreate,
    targetType: 'order',
    targetId: order.id,
    metadata: { refundId, amountCents: refundAmountCents, reason: options.reason, auto: options.auto },
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
