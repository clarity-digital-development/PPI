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
 * threshold check — those are the route handler's job. By the time we
 * get here, the decision to refund has been made.
 *
 * Ordering (matters):
 *   1. Eligibility pre-check (idempotency: already-refunded → no-op)
 *   2. Stripe refunds.create (idempotent via SHA-256 of order id)
 *   3. Persist refundId + cancellation columns on Order
 *   4. Audit OrderRefundCreate
 *   5. Release inventory holds + restore inStorage (best-effort)
 *   6. Audit OrderCancel
 *   7. Resolve recipient → sendRefundConfirmationEmail (best-effort)
 *
 * Steps 5–7 can fail without rolling back the refund (money already
 * moved). Failures are audited but never thrown to the caller.
 *
 * paymentStatus is NOT flipped to 'refunded' here — the charge.refunded
 * webhook owns that transition (single source of truth across explicit
 * + dashboard-initiated refunds).
 */
export async function refundOrder(
  orderId: string,
  options: RefundOrderOptions
): Promise<RefundOrderResult> {
  // ── 1. Load order + eligibility check ──
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, orderItems: true },
  })
  if (!order) return { ok: false, error: 'Order not found', code: 'NOT_REFUNDABLE' }
  if (order.refundId || order.paymentStatus === 'refunded') {
    return { ok: false, error: 'Order already refunded', code: 'ALREADY_REFUNDED' }
  }
  if (order.paymentStatus !== 'succeeded') {
    return { ok: false, error: 'Order is not in a refundable state', code: 'NOT_REFUNDABLE' }
  }
  if (!order.paymentIntentId) {
    return { ok: false, error: 'Order has no payment to refund', code: 'NOT_REFUNDABLE' }
  }

  // ── 2. Stripe refund (idempotent — retries return same Refund) ──
  let refundId: string
  let refundAmountCents: number
  try {
    const result = await refundPaymentIntent({
      paymentIntentId: order.paymentIntentId,
      orderId: order.id,
      reason: 'requested_by_customer',
      metadata: {
        cancel_reason: options.reason,
        actor_user_id: options.actor && 'id' in options.actor ? options.actor.id : 'system',
      },
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

  // ── 3. Persist refund metadata + cancel the order ──
  const actorId = options.actor && 'id' in options.actor ? options.actor.id : null
  await prisma.order.update({
    where: { id: order.id },
    data: {
      refundId,
      refundInitiatedAt: new Date(),
      refundReason: options.customerReason ?? null,
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByUserId: actorId,
      cancelReason: options.reason,
    },
  })

  // ── 4. Audit refund creation ──
  await audit({
    actor: options.actor,
    action: AuditAction.OrderRefundCreate,
    targetType: 'order',
    targetId: order.id,
    metadata: { refundId, amountCents: refundAmountCents, reason: options.reason, auto: options.auto },
    request: options.request,
  })

  // ── 5. Restore inventory (helper is idempotent + writes its own audit) ──
  try {
    await releaseOrderHoldsAndRestoreInventory(order.id, options.reason, options.actor, options.request)
  } catch (err) {
    console.error(`[refundOrder] inventory restore failed for ${order.id}:`, err)
  }

  // ── 6. Order-cancel audit (separate from refund audit; parallels admin cancel) ──
  await audit({
    actor: options.actor,
    action: AuditAction.OrderCancel,
    targetType: 'order',
    targetId: order.id,
    metadata: { reason: options.reason, refundId, refunded: true },
    request: options.request,
  })

  // ── 7. Resolve recipient + email (best-effort; both webhook + route may try) ──
  let emailed = false
  if (!options.skipEmail) {
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
      await prisma.order.update({
        where: { id: order.id },
        data: { refundEmailSentAt: new Date() },
      })
      emailed = true
    } catch (err) {
      console.error(`[refundOrder] email send failed for ${order.id}:`, err)
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

  return { ok: true, refundId, amountCents: refundAmountCents, emailed }
}
