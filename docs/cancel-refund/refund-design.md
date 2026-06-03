# Customer Cancel + Refund — Implementation Plan

## 1. Architecture Overview

Customer clicks Cancel on `/dashboard/orders/[id]` → confirmation modal POSTs to `POST /api/orders/[id]/cancel { confirmed: false }`. Server authenticates ownership (own order or team_admin who placed it), checks 24h cutoff against `scheduledDate`, validates status/payment eligibility. If `total >= 250` and `!confirmed`, returns `409 { requiresConfirmation: true }` — no money moves, no DB write. Client re-displays modal with high-value warning, user re-POSTs `{ confirmed: true }`. Server enters `lib/refunds.ts::refundOrder()` which: (a) generates deterministic Stripe idempotency key `sha256(orderId + ':refund_v1')`, (b) calls `stripe.refunds.create()`, (c) updates Order with `refundId` + `refundInitiatedAt` (does NOT flip paymentStatus — webhook owns that), (d) calls `releaseOrderHoldsAndRestoreInventory()`, (e) sets `Order.status = 'cancelled'`, (f) resolves refund recipient via `resolveRefundRecipient()` and sends `sendRefundConfirmationEmail()`, (g) writes `OrderRefundCreate` + `OrderCancel` audit rows. Stripe processes the refund async → fires `charge.refunded` → webhook handler looks up Order by `paymentIntentId`, idempotently flips `paymentStatus: 'refunded'` and stamps `refundedAt`/`refundedAmount`, writes `OrderRefundWebhook` audit. **Idempotency points:** (1) Stripe idempotency key prevents double-charge on retry, (2) Order.refundId uniqueness prevents two refunds for one order, (3) webhook short-circuits if `Order.paymentStatus === 'refunded'` already, (4) `refundEmailSentAt` column prevents double-send when webhook fires after explicit refund. **Failure isolation:** refund-create failure aborts everything (no DB mutation, audit `OrderRefundFail`); inventory/email/audit failures after a successful refund are logged but never roll back the money movement (audit-logged for ops).

For dashboard-initiated refunds (admin in Stripe UI), only the webhook path runs — same idempotent reconciliation + same email send (refundedBy: 'admin', auto: false, reason: 'stripe_dashboard').

---

## 2. State Machine

**Order.status transitions (customer cancel path):**
```
pending     ─┐
confirmed   ─┼─ customer cancel ──> cancelled
scheduled   ─┘
in_progress ─── BLOCKED (return 409)
completed   ─── BLOCKED (return 409)
cancelled   ─── BLOCKED (return 409)
```

**Order.paymentStatus transitions (customer cancel path):**
```
succeeded  ── refund created ──> succeeded (unchanged, refundId stamped)
                                     │
                                     └─ charge.refunded webhook ──> refunded (refundedAt stamped)

processing ── refund not viable; try PI cancel ──> failed   (no refund email)
pending    ── PI cancel ──> failed                          (no refund email)
failed     ── nothing to refund                             (no refund email; status -> cancelled only)
refunded   ── BLOCKED (already done)
```

**Intermediate "cancellation_requested" state?** No — rejected. Adds a status with no UX value (refund Stripe call is sync from our perspective; the async part is just the bank settling), and complicates the timeline UI which already handles `cancelled` cleanly. Instead we use **column-level** intermediate signals on Order: `refundInitiatedAt` (set when we call Stripe), `refundedAt` (set by webhook). UI reads "Refund processing" if `refundInitiatedAt && !refundedAt`, else "Refund complete" if `refundedAt`.

**Critical ordering inside the transaction:**
1. Stripe refunds.create (network — outside DB tx)
2. DB tx: stamp `refundId`, `refundInitiatedAt`, `status='cancelled'`
3. Holds release (own internal tx)
4. Email send (best-effort)
5. Audit row (best-effort, post-commit)

If step 2 fails after step 1 succeeded, the next admin/customer attempt will collide on the idempotency key, Stripe returns the same Refund object, and we'll re-stamp safely. Webhook is the safety net.

---

## 3. Schema Changes

**Decision: columns on Order, not a separate Refund table.** Justification: v1 is full-refund only, one refund per order; no partial-refund history to track; no need for a 1:N relation. Future partial-refund support can introduce a Refund table later and migrate the single-row columns into the first row — additive migration. Adding a table now is premature.

```prisma
// prisma/schema.prisma — Order model (additive, all nullable)

model Order {
  // ... existing fields ...

  // Refund lifecycle (v1: full refund only)
  refundId             String?   @unique @map("refund_id")              // Stripe re_xxx, unique to prevent dup-write
  refundInitiatedAt    DateTime? @map("refund_initiated_at")            // set when we call refunds.create
  refundedAt           DateTime? @map("refunded_at")                    // set by charge.refunded webhook
  refundedAmount       Decimal?  @db.Decimal(10, 2) @map("refunded_amount")  // from webhook (matches charge.amount_refunded / 100)
  refundReason         String?   @map("refund_reason")                  // free-text from customer; null for admin/dashboard initiated
  refundEmailSentAt    DateTime? @map("refund_email_sent_at")           // prevents double-send across route + webhook
  cancelledAt          DateTime? @map("cancelled_at")                   // who cancelled when (mirrors completedAt)
  cancelledByUserId    String?   @map("cancelled_by_user_id")           // who initiated; null for stripe_dashboard
  cancelReason         String?   @map("cancel_reason")                  // 'customer_cancel' | 'admin_cancel' | 'stripe_dashboard'

  cancelledBy          User?     @relation("OrderCancelledBy", fields: [cancelledByUserId], references: [id])
}

// User model — add the inverse relation
model User {
  // ... existing fields ...
  cancelledOrders Order[] @relation("OrderCancelledBy")
}
```

**Migration name:** `add_order_refund_lifecycle_columns`. All nullable, all additive — zero risk on existing rows.

**Index decision:** `refundId @unique` is sufficient. Webhook lookup uses `paymentIntentId` which is already indexed. No new indexes.

---

## 4. lib/stripe/server.ts — Refund Helper

Add ONE function. Mirror the `createPaymentIntent` shape exactly.

```ts
import crypto from 'node:crypto'

export interface CreateRefundParams {
  paymentIntentId: string
  orderId: string                       // used for deterministic idempotency key
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent'
  metadata?: Record<string, string>
}

export interface CreateRefundResult {
  refundId: string
  amount: number                        // cents
  status: Stripe.Refund.Status          // 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action'
  raw: Stripe.Refund
}

/**
 * Create a full refund for a PaymentIntent.
 * Idempotency key is deterministic from orderId — same order can never double-refund.
 * Does NOT mutate any DB state. Caller is responsible for persisting refundId.
 */
export async function refundPaymentIntent(
  params: CreateRefundParams
): Promise<CreateRefundResult> {
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(`${params.orderId}:refund_v1`)
    .digest('hex')

  const refund = await stripe().refunds.create(
    {
      payment_intent: params.paymentIntentId,
      reason: params.reason ?? 'requested_by_customer',
      metadata: {
        order_id: params.orderId,
        ...(params.metadata ?? {}),
      },
    },
    { idempotencyKey }
  )

  return {
    refundId: refund.id,
    amount: refund.amount,
    status: refund.status ?? 'pending',
    raw: refund,
  }
}
```

**Idempotency strategy:** SHA-256 of `${orderId}:refund_v1`. The `_v1` suffix lets us bump if we ever need to retry-with-different-params for a fixed bug (we won't in v1). Replaying the exact same call returns the same Refund object — no double-charge. Replaying with different params on the same key returns Stripe error `Keys for idempotent requests can only be used with the same parameters` which we surface via `getStripeErrorMessage`.

---

## 5. lib/refunds.ts (NEW) — Orchestration

```ts
// lib/refunds.ts
import { prisma } from '@/lib/prisma'
import { refundPaymentIntent, getStripeErrorMessage } from '@/lib/stripe/server'
import { releaseOrderHoldsAndRestoreInventory } from '@/lib/inventory-holds'
import { resolveRefundRecipient } from '@/lib/orders/refund-recipient'
import { sendRefundConfirmationEmail } from '@/lib/email'
import { audit, AuditAction, type Actor } from '@/lib/audit'

export const CLICK_THROUGH_THRESHOLD_CENTS = 25000  // $250

export type CancelReason = 'customer_cancel' | 'admin_cancel' | 'stripe_dashboard'

export interface RefundOrderOptions {
  reason: CancelReason
  customerReason?: string           // free text, customer-supplied
  actor: Actor
  request?: Request
  /** True = customer self-serve under threshold; False = admin click-through over threshold */
  auto: boolean
  /** Skip the email send (used by webhook when it's the second path firing) */
  skipEmail?: boolean
}

export type RefundResult =
  | { ok: true; refundId: string; amount: number; emailed: boolean }
  | { ok: false; error: string; code: 'STRIPE_ERROR' | 'NOT_REFUNDABLE' | 'ALREADY_REFUNDED' }

/**
 * Full-refund-and-cancel orchestration. Pure server-side, no auth, no threshold check —
 * callers (route handlers) are responsible for those gates.
 */
export async function refundOrder(
  orderId: string,
  options: RefundOrderOptions
): Promise<RefundResult> {
  // 1. Load order + freshness check
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

  // 2. Stripe refund (idempotent — safe to retry)
  let refundId: string
  let refundAmountCents: number
  try {
    const result = await refundPaymentIntent({
      paymentIntentId: order.paymentIntentId,
      orderId: order.id,
      reason: 'requested_by_customer',
      metadata: {
        cancel_reason: options.reason,
        actor_user_id: options.actor.userId ?? 'system',
      },
    })
    refundId = result.refundId
    refundAmountCents = result.amount
  } catch (err) {
    await audit({
      action: AuditAction.OrderRefundFail,
      targetType: 'order',
      targetId: order.id,
      metadata: { reason: options.reason, error: getStripeErrorMessage(err) },
      actor: options.actor,
      request: options.request,
    })
    return { ok: false, error: getStripeErrorMessage(err), code: 'STRIPE_ERROR' }
  }

  // 3. Persist refund metadata + cancel (single tx; webhook will flip paymentStatus later)
  await prisma.order.update({
    where: { id: order.id },
    data: {
      refundId,
      refundInitiatedAt: new Date(),
      refundReason: options.customerReason ?? null,
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByUserId: options.actor.userId ?? null,
      cancelReason: options.reason,
    },
  })

  // 4. Audit the refund creation (post-commit so it reflects committed state)
  await audit({
    action: AuditAction.OrderRefundCreate,
    targetType: 'order',
    targetId: order.id,
    metadata: {
      refundId,
      amount_cents: refundAmountCents,
      reason: options.reason,
      auto: options.auto,
    },
    actor: options.actor,
    request: options.request,
  })

  // 5. Inventory restore (best-effort, helper is already idempotent + auditing)
  try {
    await releaseOrderHoldsAndRestoreInventory(
      order.id,
      options.reason,
      options.actor,
      options.request
    )
  } catch (err) {
    console.error(`[refundOrder] inventory restore failed for ${order.id}:`, err)
    // Don't fail the refund — money already moved.
  }

  // 6. Order cancel audit (parallel to admin cancel)
  await audit({
    action: AuditAction.OrderCancel,
    targetType: 'order',
    targetId: order.id,
    metadata: { reason: options.reason, refundId, refunded: true },
    actor: options.actor,
    request: options.request,
  })

  // 7. Resolve recipient + email
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
        refundReason: options.customerReason,
        refundedAt: new Date(),
        refundedBy: options.reason === 'admin_cancel' || options.reason === 'stripe_dashboard' ? 'admin' : 'customer',
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
        action: AuditAction.OrderRefundFail,
        targetType: 'order',
        targetId: order.id,
        metadata: { stage: 'email', error: String(err) },
        actor: options.actor,
        request: options.request,
      })
    }
  }

  return { ok: true, refundId, amount: refundAmountCents, emailed }
}
```

**Note on auto-vs-click-through:** the threshold check (`>= $250`) does NOT live in `refundOrder` — it lives in the customer cancel route as a gate BEFORE calling `refundOrder`. By the time `refundOrder` is invoked, the decision is made. The `auto` flag is just metadata for the audit log + email copy.

---

## 6. lib/email.ts — sendRefundConfirmationEmail

Add to `lib/email.ts` (same file as existing helpers, inline HTML, helper-rethrow pattern):

```ts
export interface RefundConfirmationEmailProps {
  recipientName: string
  recipientEmail: string
  orderNumber: string
  propertyAddress: string
  refundAmount: number
  refundReason?: string
  refundedAt: Date
  refundedBy: 'customer' | 'admin'
  auto: boolean
}

export async function sendRefundConfirmationEmail(props: RefundConfirmationEmailProps) {
  const formattedDate = props.refundedAt.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const headerCopy = props.refundedBy === 'customer'
    ? 'Your order has been cancelled and refunded.'
    : 'Your order has been cancelled by our team and a refund has been issued.'
  const processingCopy = props.auto
    ? 'This refund was processed automatically. Funds will appear on your statement in 5-10 business days.'
    : 'This refund was approved by our team. Funds will appear on your statement in 5-10 business days.'

  const html = `
    <div style="background:#FFF0F3;padding:32px 16px;font-family:'Poppins',Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.06);overflow:hidden">
        <div style="background:#E84A7A;padding:24px;text-align:center">
          <h1 style="margin:0;color:white;font-size:24px">Refund Confirmation</h1>
        </div>
        <div style="padding:32px 24px;color:#333;line-height:1.6">
          <p>Hi ${props.recipientName},</p>
          <p>${headerCopy}</p>
          <div style="background:#FFF0F3;padding:16px;border-radius:8px;margin:24px 0">
            <p style="margin:0 0 8px"><strong>Order:</strong> ${props.orderNumber}</p>
            <p style="margin:0 0 8px"><strong>Property:</strong> ${props.propertyAddress}</p>
            <p style="margin:0 0 8px"><strong>Refund Amount:</strong> $${props.refundAmount.toFixed(2)}</p>
            <p style="margin:0"><strong>Refunded On:</strong> ${formattedDate}</p>
            ${props.refundReason ? `<p style="margin:8px 0 0"><strong>Reason:</strong> ${props.refundReason}</p>` : ''}
          </div>
          <p style="color:#666;font-size:14px">${processingCopy}</p>
          <p>Questions? Contact us at <a href="mailto:support@pinkposts.com" style="color:#E84A7A">support@pinkposts.com</a></p>
        </div>
        <div style="padding:16px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee">
          © ${new Date().getFullYear()} Pink Posts Installations. All rights reserved.
        </div>
      </div>
    </div>
  `

  try {
    return await getResend().emails.send({
      from: 'Pink Posts Installations <orders@pinkposts.com>',
      to: props.recipientEmail,
      subject: `Refund Confirmation - ${props.orderNumber}`,
      html,
    })
  } catch (error) {
    console.error('Error sending refund confirmation email:', error)
    throw error
  }
}
```

Also create `lib/orders/refund-recipient.ts` with the `resolveRefundRecipient` function exactly as pseudocoded in the UI+Data Model exploration finding #5 above. No changes to that pseudocode.

---

## 7. POST /api/orders/[id]/cancel (NEW)

```ts
// app/api/orders/[id]/cancel/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { refundOrder, CLICK_THROUGH_THRESHOLD_CENTS } from '@/lib/refunds'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const confirmed: boolean = body.confirmed === true
  const customerReason: string | undefined = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined

  // Load order (auth-aware)
  const order = await prisma.order.findUnique({
    where: { id },
    include: { user: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership: own order OR team_admin who placed it
  const isOwner = order.userId === user.id
  const isPlacer = order.placedByUserId === user.id
  if (!isOwner && !isPlacer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Status eligibility
  const blockedStatuses = ['in_progress', 'completed', 'cancelled']
  if (blockedStatuses.includes(order.status)) {
    return NextResponse.json(
      { error: `Cannot cancel an order in status: ${order.status}` },
      { status: 409 }
    )
  }
  if (order.paymentStatus !== 'succeeded') {
    // Unpaid orders: punt to admin path or handle separately
    return NextResponse.json(
      { error: 'Order is not paid; contact support to cancel' },
      { status: 409 }
    )
  }
  if (order.refundId || order.paymentStatus === 'refunded') {
    return NextResponse.json({ error: 'Order already refunded' }, { status: 409 })
  }

  // 24h cutoff (skipped if scheduledDate is null — Next Available)
  if (order.scheduledDate) {
    const installMidnightUtc = new Date(order.scheduledDate)
    installMidnightUtc.setUTCHours(0, 0, 0, 0)
    const cutoffMs = installMidnightUtc.getTime() - 24 * 60 * 60 * 1000
    if (Date.now() >= cutoffMs) {
      return NextResponse.json(
        { error: 'Cancellation window closed (must cancel at least 24 hours before install date)' },
        { status: 409 }
      )
    }
  }

  // Threshold gate
  const totalCents = Math.round(Number(order.total) * 100)
  const isHighValue = totalCents >= CLICK_THROUGH_THRESHOLD_CENTS
  if (isHighValue && !confirmed) {
    return NextResponse.json({
      requiresConfirmation: true,
      amount: Number(order.total),
      message: `This will refund $${Number(order.total).toFixed(2)} to your original payment method. Refunds take 5-10 business days to appear. Please confirm.`,
    }, { status: 409 })
  }

  // Execute refund
  const result = await refundOrder(order.id, {
    reason: 'customer_cancel',
    customerReason,
    actor: { userId: user.id, role: user.role, email: user.email },
    request,
    auto: !isHighValue,  // < $250 is auto; >= $250 is "click-through" (still automated from customer's POV, just with extra confirm)
  })

  if (!result.ok) {
    const status = result.code === 'STRIPE_ERROR' ? 502 : 409
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }

  return NextResponse.json({
    success: true,
    refundId: result.refundId,
    amount: result.amount / 100,
    emailed: result.emailed,
  })
}
```

**Response shapes:**
- `200 { success, refundId, amount, emailed }` — refunded
- `409 { requiresConfirmation: true, amount, message }` — needs second confirm
- `409 { error, code? }` — eligibility failure
- `401 / 403 / 404` — auth/ownership/missing
- `502 { error, code: 'STRIPE_ERROR' }` — Stripe failed

---

## 8. app/api/webhooks/stripe/route.ts — charge.refunded handler

Add a new `case` to the existing event switch. Mirror the idempotency pattern of `payment_intent.succeeded` (which checks `paymentStatus !== 'succeeded'` before flipping).

```ts
case 'charge.refunded': {
  const charge = event.data.object as Stripe.Charge
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id
  if (!paymentIntentId) {
    console.warn('[webhook] charge.refunded with no payment_intent', charge.id)
    break
  }

  const order = await prisma.order.findFirst({
    where: { paymentIntentId },
    include: { user: true },
  })
  if (!order) {
    console.warn('[webhook] charge.refunded — no order for PI', paymentIntentId)
    break
  }

  // Idempotency: if already reconciled, no-op
  if (order.paymentStatus === 'refunded' && order.refundedAt) {
    console.log('[webhook] charge.refunded already reconciled for order', order.id)
    break
  }

  const refundedCents = charge.amount_refunded
  const isFullRefund = refundedCents === charge.amount
  // v1: only handle full refunds. Partial refunds get logged & audited but don't flip status.
  if (!isFullRefund) {
    await audit({
      action: AuditAction.OrderRefundWebhook,
      targetType: 'order',
      targetId: order.id,
      metadata: { partial: true, refunded_cents: refundedCents, charge_amount: charge.amount, note: 'partial refunds not handled in v1' },
    })
    break
  }

  // Get the refund object for refundId (may not match order.refundId if dashboard-initiated)
  const latestRefund = charge.refunds?.data?.[0]
  const stripeRefundId = latestRefund?.id ?? order.refundId

  // Update order
  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: 'refunded',
      refundedAt: new Date(),
      refundedAmount: refundedCents / 100,
      // If dashboard-initiated, we won't have refundId yet — set it now
      ...(order.refundId ? {} : {
        refundId: stripeRefundId,
        refundInitiatedAt: new Date(),
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'stripe_dashboard',
      }),
    },
  })

  // Release inventory if not already (helper is idempotent)
  if (!order.refundId) {
    try {
      await releaseOrderHoldsAndRestoreInventory(order.id, 'stripe_dashboard', { userId: null, role: 'system', email: 'stripe@webhook' })
    } catch (err) {
      console.error('[webhook] inventory release failed for', order.id, err)
    }
  }

  // Send email if not already sent (covers dashboard-initiated case)
  if (!order.refundEmailSentAt) {
    try {
      const recipient = await resolveRefundRecipient(order)
      const propertyAddress = `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`
      await sendRefundConfirmationEmail({
        recipientName: recipient.fullName,
        recipientEmail: recipient.email,
        orderNumber: order.orderNumber,
        propertyAddress,
        refundAmount: refundedCents / 100,
        refundedAt: new Date(),
        refundedBy: 'admin',
        auto: false,
      })
      await prisma.order.update({
        where: { id: order.id },
        data: { refundEmailSentAt: new Date() },
      })
    } catch (err) {
      console.error('[webhook] refund email send failed:', err)
    }
  }

  await audit({
    action: AuditAction.OrderRefundWebhook,
    targetType: 'order',
    targetId: order.id,
    metadata: {
      refundId: stripeRefundId,
      amount_cents: refundedCents,
      dashboard_initiated: !order.refundId,
    },
  })
  break
}
```

---

## 9. app/api/admin/orders/[id]/refund/route.ts (NEW)

For the >= $250 admin click-through path. The customer endpoint already handles this with `confirmed: true` — but admins need a separate endpoint when they want to refund a paid order without the customer driving it (e.g., crew couldn't make it, customer complained).

```ts
// app/api/admin/orders/[id]/refund/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { refundOrder } from '@/lib/refunds'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const reason: string | undefined = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined

  const order = await prisma.order.findUnique({ where: { id } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.paymentStatus !== 'succeeded') {
    return NextResponse.json({ error: 'Order is not refundable' }, { status: 409 })
  }

  // No 24h cutoff for admin path — admins can refund anytime
  const result = await refundOrder(order.id, {
    reason: 'admin_cancel',
    customerReason: reason,
    actor: { userId: user.id, role: user.role, email: user.email },
    request,
    auto: false,  // admin-initiated is always click-through
  })

  if (!result.ok) {
    const status = result.code === 'STRIPE_ERROR' ? 502 : 409
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }
  return NextResponse.json({ success: true, refundId: result.refundId, amount: result.amount / 100 })
}
```

---

## 10. Customer UI — Order Detail Page

**File:** `app/dashboard/orders/[id]/page.tsx`

### 10a. Extend Order interface (lines 33-63)

Add fields:
```ts
paidAt?: string | null
scheduledDate?: string | null              // ISO string
refundId?: string | null
refundInitiatedAt?: string | null
refundedAt?: string | null
refundedAmount?: number | null
cancelledAt?: string | null
```

### 10b. Add cancellation helper

```ts
function canCancel(order: Order): boolean {
  if (['in_progress', 'completed', 'cancelled'].includes(order.status)) return false
  if (order.paymentStatus !== 'succeeded') return false
  if (order.refundId || order.paymentStatus === 'refunded') return false
  if (!order.scheduledDate) return true  // Next Available — always cancellable
  const installMidnightUtc = new Date(order.scheduledDate)
  installMidnightUtc.setUTCHours(0, 0, 0, 0)
  const cutoffMs = installMidnightUtc.getTime() - 24 * 60 * 60 * 1000
  return Date.now() < cutoffMs
}
```

### 10c. Cancel button in Actions row (line ~447)

```tsx
{canCancel(order) && (
  <Button
    variant="outline"
    onClick={() => setCancelModalOpen(true)}
    className="border-red-300 text-red-600 hover:bg-red-50"
  >
    Cancel Order
  </Button>
)}
```

### 10d. CancelOrderModal (new component, inline or `components/CancelOrderModal.tsx`)

State: `step: 'initial' | 'high-value' | 'submitting' | 'done' | 'error'`. Flow:
1. `initial` → "Cancel this order? This will refund $X to your card." with Confirm/Cancel buttons.
2. On Confirm → `POST /api/orders/[id]/cancel { confirmed: false, reason }`.
3. If `409 { requiresConfirmation: true }` → step becomes `high-value`, message swaps to "This refund is over $250. Refunds take 5-10 business days. Are you absolutely sure?"
4. On Confirm → `POST { confirmed: true, reason }`. Move to `submitting`.
5. On success → `done`, close modal, `refetch()` order data.
6. On error → `error`, show message.

Optional `reason` textarea always visible (placeholder: "Tell us why you're cancelling (optional)"). 500-char limit client-side.

### 10e. Enhance "Cancelled Notice" card (lines ~318-326)

When order is cancelled, show refund state:
```tsx
{order.cancelledAt && (
  <p className="text-sm text-red-700 mt-2">
    Cancelled on {formatDate(order.cancelledAt)}
    {order.refundedAt ? (
      <> — Refund of ${order.refundedAmount?.toFixed(2)} processed on {formatDate(order.refundedAt)}</>
    ) : order.refundInitiatedAt ? (
      <> — Refund of ${Number(order.total).toFixed(2)} processing (5-10 business days)</>
    ) : null}
  </p>
)}
```

### 10f. Expand `/api/orders/[id]/route.ts` response

Add `select` for: `paidAt`, `scheduledDate`, `refundId`, `refundInitiatedAt`, `refundedAt`, `refundedAmount`, `cancelledAt`. Also broaden the `where` clause to allow `placedByUserId === user.id` (team_admin viewing orders they placed for an agent).

---

## 11. Admin UI

**File:** `app/admin/orders/[id]/page.tsx` (assuming standard layout — confirm path)

Add a banner section visible when `paymentStatus === 'succeeded' && !order.refundId && Number(order.total) >= 250 && cancellation_pending`. v1 doesn't have a formal "cancellation request" state, so the simpler approach:

**Add a "Refund Order" button** in the admin order detail action row, visible when `paymentStatus === 'succeeded' && !order.refundId`. Click opens a confirmation modal showing the amount + a reason textarea, then POSTs to `/api/admin/orders/[id]/refund`. This is the admin click-through endpoint built in #9.

No "pending refund request from customer" banner needed in v1 — the customer endpoint either processes the refund immediately (with their second confirm) or it doesn't happen. There's no async approval queue.

If future iteration wants admin approval queue: add `Order.refundRequestedAt` + an admin notifications panel. Out of scope.

---

## 12. Audit Events

| Event | Action | Where | Metadata |
|---|---|---|---|
| Customer requests cancel (high-value, awaiting 2nd confirm) | none yet | — | Not audited; no state change |
| Refund created (Stripe call succeeded) | `OrderRefundCreate` | `lib/refunds.ts` step 4 | `{ refundId, amount_cents, reason, auto }` |
| Refund Stripe call failed | `OrderRefundFail` | `lib/refunds.ts` step 2 catch | `{ reason, error }` |
| Order cancelled (post-refund) | `OrderCancel` | `lib/refunds.ts` step 6 | `{ reason, refundId, refunded: true }` |
| Inventory restored | `InventoryHoldReleased` | `releaseOrderHoldsAndRestoreInventory` (existing) | unchanged |
| Refund email send failed | `OrderRefundFail` | `lib/refunds.ts` step 7 catch | `{ stage: 'email', error }` |
| Webhook reconciliation | `OrderRefundWebhook` | webhook handler | `{ refundId, amount_cents, dashboard_initiated }` |

All audit calls go through existing `audit()` helper which is no-throw.

---

## 13. Idempotency Strategy (Concrete)

| Layer | Mechanism | Guarantees |
|---|---|---|
| Stripe API call | Idempotency-Key header = `sha256(orderId + ':refund_v1')` | Retried network call returns same Refund object; no double-charge |
| Order.refundId | `@unique` column | DB rejects writing two different refund IDs to one order |
| Webhook handler | Short-circuit if `paymentStatus === 'refunded' && refundedAt` set | Replayed `charge.refunded` events are no-ops |
| Email send | Check `refundEmailSentAt` before sending; stamp after | Customer doesn't get two emails (route + webhook path) |
| refundOrder() entry | Check `order.refundId || paymentStatus === 'refunded'` → returns `ALREADY_REFUNDED` | Double-click protection at orchestration layer |
| Customer endpoint | Threshold gate forces 2-step on >= $250 | Misclicks on high-value orders surface confirm dialog |

**No Refund table.** Order.refundId being unique + the orchestration's pre-check is enough for v1 single-refund-per-order invariant.

---

## 14. Test Checklist

Pre-merge manual tests against Stripe test mode:

1. **Auto refund under $250** — Place order with total $150, pay (test card `4242…`), wait for confirmation, go to order detail, click Cancel, confirm in modal. Expect: order shows cancelled, refund processing, email arrives at customer (regular non-team user), Stripe dashboard shows refund.
2. **Click-through over $250** — Place $300 order, pay, click Cancel. Expect: first confirm returns 409 + modal shows high-value warning, second confirm processes refund.
3. **< 24h cutoff blocked** — Place order with scheduledDate = tomorrow (UTC midnight - 12h), pay. Expect: Cancel button hidden on detail page; manual POST to `/api/orders/[id]/cancel` returns 409 with cutoff message.
4. **Next Available cancellable anytime** — Place order with no scheduledDate, pay. Expect: Cancel button visible regardless of time.
5. **Stripe-dashboard refund reconciled** — Place + pay order, then refund via Stripe Dashboard. Expect: webhook fires, order flips to cancelled + refunded, email sent to recipient, audit row `OrderRefundWebhook` with `dashboard_initiated: true`, inventory restored.
6. **Double-click idempotency** — In two browser tabs, POST cancel simultaneously. Expect: one returns success, the other returns `ALREADY_REFUNDED`; Stripe shows exactly one refund.
7. **Email goes to broker, not agent** — Create team with team_admin + agent. Have team_admin place an order on behalf of agent (sets `placedByUserId`). Pay, cancel. Expect: email arrives at team_admin's address, NOT agent's.
8. **Inventory restored** — Place order that claims a specific sign (not from generic stock), pay, cancel. Expect: sign returns to `inStorage: true` (assuming no other live order/hold), `InventoryHoldReleased` audit row written.
9. **Audit rows present** — After a successful customer cancel, query AuditLog for the order. Expect: `OrderRefundCreate`, `InventoryHoldReleased`, `OrderCancel` (3 rows minimum), plus `OrderRefundWebhook` after Stripe processes.
10. **In-progress order blocked** — Manually flip an order to `in_progress`, attempt cancel. Expect: 409.

---

## 15. Effort Estimate

| File | Estimate | Notes |
|---|---|---|
| `prisma/schema.prisma` + migration | 20 min | Additive columns, run + verify migration |
| `lib/stripe/server.ts` (refundPaymentIntent) | 20 min | Mirror createPaymentIntent shape |
| `lib/orders/refund-recipient.ts` (NEW) | 30 min | Logic + 2-3 unit-test scenarios in head |
| `lib/refunds.ts` (NEW) | 1h | Orchestration; care around ordering + error isolation |
| `lib/email.ts` (sendRefundConfirmationEmail) | 30 min | HTML template lift from sibling |
| `app/api/orders/[id]/cancel/route.ts` (NEW) | 45 min | Auth + cutoff + threshold gate |
| `app/api/orders/[id]/route.ts` (extend select + where) | 15 min | Add refund fields + broaden ownership |
| `app/api/admin/orders/[id]/refund/route.ts` (NEW) | 20 min | Thin wrapper over refundOrder |
| `app/api/webhooks/stripe/route.ts` (charge.refunded case) | 1h | Idempotency + dashboard-initiated path is the gnarly bit |
| `app/dashboard/orders/[id]/page.tsx` (button + modal + cancelled card) | 1.5h | Modal state machine + 2-step confirm UX |
| Admin order detail Refund button + modal | 45 min | Mirror customer modal, simpler (no 2-step) |
| Manual testing (checklist above) | 1h | Stripe test mode, webhook tunneling |
| **Total** | **~7.5h** | Within target 6-8h |

**Risk hotspots** (allocate more time if discovered):
- Webhook idempotency around dashboard-initiated refunds where `order.refundId` is null at first webhook fire but populated by a concurrent route call — guarded by the `order.paymentStatus === 'refunded'` early exit.
- `scheduledDate` TZ math — write a tiny test or console-log a few sample dates to confirm noon-UTC subtraction lands at the right cutoff.
- Team-admin ownership broadening on `GET /api/orders/[id]` may surface orders the team_admin shouldn't see yet — verify against the existing team-orders authorization helpers.

Key files (absolute paths):
- `c:\Users\tanne\PPI\prisma\schema.prisma`
- `c:\Users\tanne\PPI\lib\stripe\server.ts`
- `c:\Users\tanne\PPI\lib\refunds.ts` (NEW)
- `c:\Users\tanne\PPI\lib\orders\refund-recipient.ts` (NEW)
- `c:\Users\tanne\PPI\lib\email.ts`
- `c:\Users\tanne\PPI\app\api\orders\[id]\cancel\route.ts` (NEW)
- `c:\Users\tanne\PPI\app\api\orders\[id]\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\orders\[id]\refund\route.ts` (NEW)
- `c:\Users\tanne\PPI\app\api\webhooks\stripe\route.ts`
- `c:\Users\tanne\PPI\app\dashboard\orders\[id]\page.tsx`
- `c:\Users\tanne\PPI\app\admin\orders\[id]\page.tsx`