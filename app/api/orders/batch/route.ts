import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, generateOrderNumber } from '@/lib/auth-utils'
import { createPaymentIntent, createCustomer, getStripeErrorMessage, stripe } from '@/lib/stripe/server'
import { computeOrderPricing, computeFlatFeePricing } from '@/lib/orders/pricing'
import { claimHoldsInTx, HoldConflictError, releaseHolds, type HoldClaim } from '@/lib/inventory-holds'
import { validateScheduling } from '@/lib/scheduling'
import crypto from 'node:crypto'
import { audit, AuditAction } from '@/lib/audit'
import { resolveServiceArea, type ResolveResult } from '@/lib/service-area'
import type { HoldItemType } from '@prisma/client'
import { sendOrderConfirmationEmail, sendAdminOrderNotification } from '@/lib/email'
import { resolveAssignedAgent } from '@/lib/orders/assigned-agent'

/**
 * Batch order placement. The cart hits this endpoint once with N orders
 * so the customer's card is hit with a SINGLE combined charge instead of
 * N separate transactions on their statement.
 *
 * - All N orders share one PaymentIntent (Order.paymentIntentId)
 * - The webhook's payment_intent.succeeded handler already uses findMany
 *   to update every order with that PI id together
 * - Inventory updates happen per-order inside the same transaction as
 *   order creation
 * - If the bank requires 3DS, returns client_secret so the cart can call
 *   stripe.handleNextAction() to finish authentication
 */

type BatchOrderBody = {
  property_type: string
  property_address: string
  property_city: string
  property_state?: string
  property_zip: string
  installation_location?: string
  installation_location_image?: string
  installation_notes?: string
  is_gated_community?: boolean
  gate_code?: string
  has_marker_placed?: boolean
  sign_orientation?: string
  sign_orientation_other?: string
  post_type?: string
  items: Array<{
    item_type: string
    item_category?: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
    customer_sign_id?: string
    customer_rider_id?: string
    customer_lockbox_id?: string
    customer_brochure_box_id?: string
    custom_value?: string
    // Map of inventory-field-name (customer_sign_id | customer_rider_id |
    // customer_lockbox_id) -> InventoryHold.id acquired earlier in the cart.
    // Absent => fall back to the blind inStorage flip (brochure boxes or
    // pre-holds-rollout carts).
    hold_ids?: Record<string, string>
  }>
  requested_date?: string
  is_expedited?: boolean
  placed_for_agent_name?: string
}

// Field-to-itemType map for hold_ids: the cart sends the inventory column
// name as the key so the client doesn't have to know about HoldItemType.
const HOLD_FIELD_TO_TYPE: Record<string, HoldItemType> = {
  customer_sign_id: 'sign',
  customer_rider_id: 'rider',
  customer_lockbox_id: 'lockbox',
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getCurrentUser()
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const orders: BatchOrderBody[] = body.orders || []
    const paymentMethodId: string | undefined = body.payment_method_id
    const cartSessionId: string | null = typeof body.cart_session_id === 'string' ? body.cart_session_id : null

    // Invoice-billing accounts (admin-toggled at /admin/customers/[id]) skip
    // the Stripe charge at checkout entirely. Orders are saved as
    // pending_invoice and bundled later by an admin from /admin/invoices.
    const isInvoiceBilling = !!actor.invoiceBilling

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ error: 'Batch must contain at least one order' }, { status: 400 })
    }
    if (!isInvoiceBilling && !paymentMethodId) {
      return NextResponse.json({ error: 'payment_method_id is required' }, { status: 400 })
    }

    // ---- Step 1: validate and compute pricing for each order ----
    type Computed = {
      orderBody: BatchOrderBody
      pricing: ReturnType<typeof computeOrderPricing>
      postTypeId: string | null
      // Holds claimed during checkout (one entry per item that came with a hold_id).
      claims: HoldClaim[]
      // Service-area resolution for this order (surcharge winner is carried to OrderItem create).
      serviceArea: ResolveResult
    }
    const computed: Computed[] = []

    // Service-area gate runs per-order. ANY out_of_area aborts the whole batch
    // so the customer's card isn't charged for a partially-doomed cart.
    const saBlocks: Array<{ orderIndex: number; zip: string; reason?: string; contactPhone?: string }> = []

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i]
      if (!o.items || o.items.length === 0) {
        return NextResponse.json({ error: `Order ${i + 1} has no items` }, { status: 400 })
      }
      if (!o.property_address || !o.property_city || !o.property_zip || !o.property_type) {
        return NextResponse.json({ error: `Order ${i + 1} is missing a required property field` }, { status: 400 })
      }

      // Server-side schedule gate (same reason as /api/orders POST — wizard
      // min= is client-side decoration, can't be trusted).
      const scheduleCheck = validateScheduling({
        requestedDate: o.requested_date,
        isExpedited: o.is_expedited,
      })
      if (!scheduleCheck.ok) {
        return NextResponse.json(
          { error: `Order ${i + 1}: ${scheduleCheck.error}`, code: scheduleCheck.code },
          { status: 400 }
        )
      }

      // Service-area gate. Actor is the wallet → exemption check is on actor.
      const effectiveUser = {
        id: actor.id,
        role: actor.role,
        isServiceAreaExempt: actor.isServiceAreaExempt ?? false,
      }
      const sa = await resolveServiceArea({
        zip: o.property_zip,
        user: effectiveUser,
        address: {
          street: o.property_address,
          city: o.property_city,
          state: o.property_state ?? 'KY',
          zip: o.property_zip,
        },
      })
      if (sa.tier === 'out_of_area') {
        saBlocks.push({
          orderIndex: i,
          zip: o.property_zip,
          reason: sa.reason,
          contactPhone: sa.contactPhone,
        })
        await audit({
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: AuditAction.ServiceAreaBlock,
          targetType: 'cart',
          targetId: cartSessionId,
          metadata: {
            orderIndex: i,
            zip: o.property_zip,
            reason: sa.reason ?? null,
            attemptedTotal: o.items.reduce((s, it) => s + it.total_price, 0),
            centersChecked: 5,
          },
          request,
        })
        // Continue scanning so the response can list every failed order at once.
        continue
      }
      // surcharge → push a synthetic OrderItem so it flows through pricing + display.
      // Round 25 fix: see app/api/orders/route.ts — gate on tier+amount only
      // so the ZIP-override branch (no decidedBy) still injects the line.
      if (sa.tier === 'surcharge' && sa.surchargeCents > 0) {
        const surchargeDollars = sa.surchargeCents / 100
        const description = sa.decidedBy
          ? `Out-of-area service fee – ${sa.decidedBy.centerName} ~${Math.round(sa.decidedBy.driveTimeMinutes)}min`
          : `Out-of-area service fee – ZIP ${o.property_zip}`
        o.items.push({
          item_type: 'surcharge',
          item_category: undefined,
          description,
          quantity: 1,
          unit_price: surchargeDollars,
          total_price: surchargeDollars,
        } as BatchOrderBody['items'][number])
      }

      // Look up the post type (skip 'open_house' and missing post_type)
      let postTypeId: string | null = null
      if (o.post_type && o.post_type !== 'open_house') {
        const pt = await prisma.postType.findFirst({ where: { name: o.post_type } })
        if (!pt) {
          return NextResponse.json(
            { error: `Order ${i + 1}: invalid post type "${o.post_type}"` },
            { status: 400 }
          )
        }
        postTypeId = pt.id
      }

      // CR4 (Round 22): flat-fee accounts pay a fixed $66.07 per order
      // regardless of items. Clamp here so grandTotal, the PaymentIntent, and
      // the persisted totals are all flat; real items still flow to fulfillment.
      const pricing = actor.flatFeeBilling
        ? computeFlatFeePricing()
        : computeOrderPricing({
            items: o.items,
            hasPostType: !!o.post_type,
            isExpedited: !!o.is_expedited,
          })

      // Build the claim list for this order from any hold_ids the cart sent.
      const claims: HoldClaim[] = []
      for (const item of o.items) {
        if (!item.hold_ids) continue
        for (const [field, holdId] of Object.entries(item.hold_ids)) {
          const itemType = HOLD_FIELD_TO_TYPE[field]
          if (!itemType) continue
          const itemId =
            field === 'customer_sign_id' ? item.customer_sign_id
            : field === 'customer_rider_id' ? item.customer_rider_id
            : field === 'customer_lockbox_id' ? item.customer_lockbox_id
            : undefined
          if (!itemId || !holdId) continue
          claims.push({ holdId, itemType, itemId })
        }
      }

      computed.push({ orderBody: o, pricing, postTypeId, claims, serviceArea: sa })
    }

    // Any out-of-area order kills the whole batch — abort BEFORE Stripe.
    if (saBlocks.length > 0) {
      const firstPhone = saBlocks.find((b) => b.contactPhone)?.contactPhone
      const list = saBlocks.map((b) => `#${b.orderIndex + 1} (${b.zip})`).join(', ')
      return NextResponse.json(
        {
          error: `We don't currently service the ZIP for order(s) ${list}. Please call ${firstPhone ?? '859-395-8188'} to discuss options.`,
          code: 'service_area_unavailable',
          contactPhone: firstPhone,
          failed_orders: saBlocks.map((b) => ({
            order_index: b.orderIndex,
            zip: b.zip,
            reason: b.reason,
          })),
        },
        { status: 400 }
      )
    }

    const grandTotal = computed.reduce((sum, c) => sum + c.pricing.total, 0)
    if (grandTotal <= 0) {
      return NextResponse.json({ error: 'Batch total must be greater than $0' }, { status: 400 })
    }

    // ---- Step 1.5: PRE-VALIDATE holds BEFORE touching Stripe ----
    // If any hold is stale/lost/foreign, we return 409 now — no PaymentIntent
    // ever created, so the customer cannot be charged for a doomed checkout.
    const allClaims = computed.flatMap((c) => c.claims)
    if (allClaims.length > 0) {
      const liveHolds = await prisma.inventoryHold.findMany({
        where: {
          id: { in: allClaims.map((h) => h.holdId) },
          consumedByOrderId: null,
          releasedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, ownerUserId: true, itemType: true, itemId: true },
      })
      const liveById = new Map(liveHolds.map((h) => [h.id, h]))
      const conflicts: Array<{ code: string; item_type: HoldItemType; item_id: string; hold_id: string }> = []
      for (const claim of allClaims) {
        const live = liveById.get(claim.holdId)
        if (!live) {
          conflicts.push({ code: 'hold_lost', item_type: claim.itemType, item_id: claim.itemId, hold_id: claim.holdId })
          continue
        }
        if (live.ownerUserId !== actor.id) {
          // Foreign hold — never leak which item or who. Treat as unavailable.
          conflicts.push({ code: 'item_unavailable', item_type: claim.itemType, item_id: claim.itemId, hold_id: claim.holdId })
          continue
        }
        if (live.itemType !== claim.itemType || live.itemId !== claim.itemId) {
          conflicts.push({ code: 'hold_lost', item_type: claim.itemType, item_id: claim.itemId, hold_id: claim.holdId })
        }
      }
      if (conflicts.length > 0) {
        await audit({
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: AuditAction.CartCheckoutFail,
          targetType: 'cart',
          targetId: cartSessionId,
          metadata: { stage: 'prevalidate', conflicts, grandTotal },
          request,
        })
        return NextResponse.json(
          { error: 'item_unavailable', code: 'hold_conflict', conflicts },
          { status: 409 }
        )
      }
    }

    // ---- Step 2: ensure actor has a Stripe customer (the payer) ----
    // Skipped for invoice-billing accounts; the Stripe customer is created
    // lazily on the customer-facing invoice page when the customer pays.
    let stripeCustomerId = actor.stripeCustomerId
    if (!isInvoiceBilling && !stripeCustomerId) {
      try {
        const c = await createCustomer(actor.email, actor.fullName || actor.name || '')
        stripeCustomerId = c.id
        await prisma.user.update({ where: { id: actor.id }, data: { stripeCustomerId } })
      } catch (err) {
        console.error('Batch: could not create Stripe customer:', err)
        return NextResponse.json(
          { error: getStripeErrorMessage(err) || 'Unable to set up payment for this batch.' },
          { status: 400 }
        )
      }
    }

    // ---- Step 3: create all orders in a transaction (NO PaymentIntent yet) ----
    //
    // Tx-first is the headline money-safety guarantee. Creating the PI BEFORE
    // the order tx means a tx failure leaves a captured PI with no order —
    // customer is charged for nothing. Creating it AFTER means a PI failure
    // leaves un-billed orders, which an operator can charge manually or
    // cancel. Un-billed orders are dramatically safer than un-ordered charges.
    //
    // Orders are created with paymentIntentId: null and paymentStatus: 'pending',
    // then updated with the real PI id once Stripe accepts it (Step 5).

    // Track which item ids were claimed-via-hold so the blind path skips them.
    const heldItemIds = new Set<string>()
    for (const claim of allClaims) heldItemIds.add(`${claim.itemType}:${claim.itemId}`)

    let createdOrders: Array<{ id: string; orderNumber: string; total: number }>
    try {
      createdOrders = await prisma.$transaction(async (tx) => {
        const out: Array<{ id: string; orderNumber: string; total: number }> = []
        for (const c of computed) {
          const o = c.orderBody
          const order = await tx.order.create({
            data: {
              orderNumber: generateOrderNumber(),
              userId: actor.id, // batch is always under the actor (no on-behalf-of in cart)
              placedForAgentName: o.placed_for_agent_name?.trim() || null,
              postTypeId: c.postTypeId,
              propertyType: o.property_type as any,
              propertyAddress: o.property_address,
              propertyCity: o.property_city,
              propertyState: o.property_state || 'KY',
              propertyZip: o.property_zip,
              propertyNotes: o.installation_notes,
              installationLocation: o.installation_location,
              installationLocationImage: o.installation_location_image,
              isGatedCommunity: o.is_gated_community || false,
              gateCode: o.gate_code,
              hasMarkerPlaced: o.has_marker_placed || false,
              signOrientation: o.sign_orientation,
              signOrientationOther: o.sign_orientation_other,
              scheduledDate: o.requested_date ? new Date(o.requested_date + 'T12:00:00Z') : null,
              isExpedited: !!o.is_expedited,
              subtotal: c.pricing.subtotal,
              fuelSurcharge: c.pricing.fuelSurcharge,
              noPostSurcharge: c.pricing.noPostSurcharge,
              // CR2: agent's own post / no PPI post ⇒ no recurring post-rental.
              postRentalDisabled: !o.post_type,
              expediteFee: c.pricing.expediteFee,
              discount: c.pricing.discount,
              tax: c.pricing.tax,
              total: c.pricing.total,
              // CR4: mark flat-fee orders so edits recompute as flat (no diff).
              flatFeeApplied: !!actor.flatFeeBilling,
              // WHY: persist actual surcharge so reporting + invoice math match what the customer paid.
              serviceAreaSurchargeCents: actor.flatFeeBilling
                ? 0
                : c.serviceArea.tier === 'surcharge' ? c.serviceArea.surchargeCents : 0,
              serviceAreaCenterId: c.serviceArea.decidedBy?.centerId ?? null,
              serviceAreaDriveMinutes: c.serviceArea.decidedBy?.driveTimeMinutes ?? null,
              serviceAreaDriveTimeSource: c.serviceArea.decidedBy?.driveTimeSource ?? null,
              paymentIntentId: null,
              paymentStatus: isInvoiceBilling ? 'pending_invoice' : 'pending',
              paidAt: null,
              orderItems: {
                create: o.items.map((item) => ({
                  itemType: item.item_type,
                  itemCategory: item.item_category || null,
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: item.unit_price,
                  totalPrice: item.total_price,
                  customerSignId: item.customer_sign_id || null,
                  customerRiderId: item.customer_rider_id || null,
                  customerLockboxId: item.customer_lockbox_id || null,
                  customerBrochureBoxId: item.customer_brochure_box_id || null,
                  customValue: item.custom_value || null,
                })),
              },
            },
            select: { id: true, orderNumber: true, total: true },
          })
          out.push({ id: order.id, orderNumber: order.orderNumber, total: Number(order.total) })

          // Hold-backed items: convert holds -> assignments atomically. This
          // flips inStorage, clears the hold cols, and marks the hold
          // consumed in a single conditional UPDATE. Throws HoldConflictError
          // on any race — the surrounding tx rolls back and the catch below
          // cancels the PaymentIntent.
          if (c.claims.length > 0) {
            await claimHoldsInTx(
              tx,
              c.claims,
              order.id,
              { id: actor.id, email: actor.email, role: actor.role },
              request
            )
          }

          // Blind path: only items WITHOUT a live hold (brochure boxes always;
          // signs/riders/lockboxes only for pre-rollout carts that didn't send
          // a hold_id). Skip any item that was already claimed above.
          const invUpdates: Promise<unknown>[] = []
          for (const item of o.items) {
            if (item.customer_sign_id && !heldItemIds.has(`sign:${item.customer_sign_id}`))
              invUpdates.push(tx.customerSign.update({ where: { id: item.customer_sign_id }, data: { inStorage: false } }))
            if (item.customer_rider_id && !heldItemIds.has(`rider:${item.customer_rider_id}`))
              invUpdates.push(tx.customerRider.update({ where: { id: item.customer_rider_id }, data: { inStorage: false } }))
            if (item.customer_lockbox_id && !heldItemIds.has(`lockbox:${item.customer_lockbox_id}`))
              invUpdates.push(tx.customerLockbox.update({ where: { id: item.customer_lockbox_id }, data: { inStorage: false } }))
            if (item.customer_brochure_box_id)
              invUpdates.push(tx.customerBrochureBox.update({ where: { id: item.customer_brochure_box_id }, data: { inStorage: false } }))
          }
          if (invUpdates.length) await Promise.all(invUpdates)
        }
        return out
      })
    } catch (txError) {
      // Tx failed → no orders, no PI, no charge. Release any holds the user
      // managed to acquire so they aren't locked out for 15 min on a retry.
      // (releaseHolds.{actor} expects the AuditActor shape.)
      if (allClaims.length > 0) {
        await Promise.all(
          allClaims.map((c) =>
            releaseHolds(
              { actor: { id: actor.id, email: actor.email, role: actor.role }, holdId: c.holdId },
              { reason: 'tx_rollback' }
            ).catch((err) => console.error('Batch: release after tx fail:', c.holdId, err))
          )
        )
      }

      if (txError instanceof HoldConflictError) {
        const conflict = {
          code: txError.code,
          item_type: (txError.details.itemType as HoldItemType) ?? null,
          item_id: (txError.details.itemId as string) ?? null,
          hold_id: (txError.details.holdId as string) ?? null,
        }
        try {
          await audit({
            actor: { id: actor.id, email: actor.email, role: actor.role },
            action: AuditAction.CartCheckoutFail,
            targetType: 'cart',
            targetId: cartSessionId,
            metadata: { stage: 'tx_claim', conflict },
            request,
          })
        } catch (auditErr) {
          console.error('Batch: failed to audit tx_claim conflict:', auditErr)
        }
        return NextResponse.json(
          { error: 'item_unavailable', code: 'hold_conflict', conflicts: [conflict] },
          { status: 409 }
        )
      }

      try {
        await audit({
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: AuditAction.CartCheckoutFail,
          targetType: 'cart',
          targetId: cartSessionId,
          metadata: { stage: 'tx_other', message: (txError as Error)?.message ?? null },
          request,
        })
      } catch (auditErr) {
        console.error('Batch: failed to audit tx_other failure:', auditErr)
      }
      throw txError
    }

    // ---- Step 3.5: invoice-billing branch — orders are saved as
    //                pending_invoice, no Stripe PI, no charge. Send confirmation
    //                emails so the customer + admin know the order landed, then
    //                return successfully. The admin bundles + collects later.
    if (isInvoiceBilling) {
      // Audit each surcharge — same as the paid flow.
      for (let i = 0; i < createdOrders.length; i++) {
        const sa = computed[i].serviceArea
        if (sa.tier === 'surcharge' && sa.decidedBy) {
          await audit({
            actor: { id: actor.id, email: actor.email, role: actor.role },
            action: AuditAction.ServiceAreaSurchargeApplied,
            targetType: 'order',
            targetId: createdOrders[i].id,
            metadata: {
              centerId: sa.decidedBy.centerId,
              centerName: sa.decidedBy.centerName,
              driveTimeMinutes: sa.decidedBy.driveTimeMinutes,
              surchargeCents: sa.surchargeCents,
              zip: computed[i].orderBody.property_zip,
            },
            request,
          })
        }
      }

      for (const co of createdOrders) {
        const reserved = await prisma.order.updateMany({
          where: { id: co.id, confirmationEmailSentAt: null },
          data: { confirmationEmailSentAt: new Date() },
        })
        if (reserved.count === 0) continue
        try {
          const full = await prisma.order.findUnique({
            where: { id: co.id },
            include: { orderItems: true, user: true, postType: { select: { name: true } } },
          })
          if (!full) continue
          const assignedAgent = await resolveAssignedAgent({
            placedForAgentName: full.placedForAgentName,
            teamId: full.user.teamId,
          })
          await Promise.all([
            sendOrderConfirmationEmail({
              customerName: full.user.fullName || full.user.name || '',
              customerEmail: full.user.email,
              orderNumber: full.orderNumber,
              propertyAddress: `${full.propertyAddress}, ${full.propertyCity}, ${full.propertyState} ${full.propertyZip}`,
              total: Number(full.total),
              items: full.orderItems.map((it) => ({
                description: it.description,
                quantity: it.quantity,
                total_price: Number(it.totalPrice),
              })),
              requestedDate: full.scheduledDate?.toISOString(),
              installationNotes: full.propertyNotes || undefined,
              recipientUserId: full.userId,
              isInvoiceBilling: true,
            }),
            sendAdminOrderNotification({
              orderNumber: full.orderNumber,
              customerName: full.user.fullName || full.user.name || '',
              customerEmail: full.user.email,
              customerPhone: full.user.phone || '',
              propertyAddress: `${full.propertyAddress}, ${full.propertyCity}, ${full.propertyState} ${full.propertyZip}`,
              total: Number(full.total),
              items: full.orderItems.map((it) => ({
                description: it.description,
                quantity: it.quantity,
                total_price: Number(it.totalPrice),
              })),
              requestedDate: full.scheduledDate?.toISOString(),
              isExpedited: full.isExpedited,
              // Pass postType so the email shows the real post (e.g. "Black
              // Vinyl Post") instead of falling through to the "None
              // (service trip only)" default. Real service trips have
              // postType=null and correctly land on the default copy.
              postType: full.postType?.name || undefined,
              installationNotes: full.propertyNotes || undefined,
              installationLocation: full.installationLocation || undefined,
              isGatedCommunity: full.isGatedCommunity,
              gateCode: full.gateCode || undefined,
              hasMarkerPlaced: full.hasMarkerPlaced,
              signOrientation: full.signOrientation || undefined,
              signOrientationOther: full.signOrientationOther || undefined,
              subtotal: Number(full.subtotal),
              discount: Number(full.discount),
              fuelSurcharge: Number(full.fuelSurcharge),
              noPostSurcharge: Number(full.noPostSurcharge),
              expediteFee: Number(full.expediteFee),
              tax: Number(full.tax),
              assignedAgentName: assignedAgent?.name ?? null,
              assignedAgentPhone: assignedAgent?.phone ?? null,
              isInvoiceBilling: true,
            }),
          ])
        } catch (emailError) {
          console.error(`Batch (invoice): failed to send emails for order ${co.orderNumber}:`, emailError)
          await prisma.order.updateMany({
            where: { id: co.id, confirmationEmailSentAt: { not: null } },
            data: { confirmationEmailSentAt: null },
          }).catch(() => {})
        }
      }

      try {
        await audit({
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: AuditAction.CartCheckoutSucceed,
          targetType: 'cart',
          targetId: cartSessionId,
          metadata: {
            orderIds: createdOrders.map((o) => o.id),
            orderCount: createdOrders.length,
            grandTotal,
            paymentIntentId: null,
            paymentStatus: 'pending_invoice',
            invoiceBilling: true,
          },
          request,
        })
      } catch (auditErr) {
        console.error('Batch (invoice): failed to audit success:', auditErr)
      }

      return NextResponse.json({
        status: 'pending_invoice',
        client_secret: null,
        grand_total: grandTotal,
        orders: createdOrders,
        invoice_billing: true,
      })
    }

    // ---- Step 4: create the PaymentIntent NOW that orders exist ----
    //
    // Deterministic idempotency key — same cart + same actor + same total
    // within 24h returns the same PI from Stripe, so a network-retry double-
    // submit can't create two PIs and double-charge. (The hold-claim race
    // already prevents double-orders at the DB level; this is belt-and-
    // suspenders for the rarer "client retried, server already responded"
    // case.)
    const idemKey = crypto
      .createHash('sha256')
      .update(`${actor.id}|${cartSessionId ?? createdOrders.map((o) => o.id).sort().join(',')}|${grandTotal.toFixed(2)}`)
      .digest('hex')
      .slice(0, 64)

    let paymentIntent
    try {
      paymentIntent = await createPaymentIntent(grandTotal, stripeCustomerId ?? undefined, paymentMethodId, { idempotencyKey: idemKey })
    } catch (err) {
      console.error('Batch: PI creation failed AFTER tx commit. Orders exist unpaid:', createdOrders.map((o) => o.id), err)
      try {
        await audit({
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: AuditAction.CartCheckoutFail,
          targetType: 'cart',
          targetId: cartSessionId,
          metadata: {
            stage: 'pi_create_failed_after_tx',
            orderIds: createdOrders.map((o) => o.id),
            grandTotal,
            stripeMessage: getStripeErrorMessage(err) ?? null,
          },
          request,
        })
      } catch (auditErr) {
        console.error('Batch: failed to audit pi_create_failed_after_tx:', auditErr)
      }
      return NextResponse.json(
        {
          error: getStripeErrorMessage(err) || 'Payment failed. Your orders were saved but not charged. Please contact support.',
          orders_pending_payment: createdOrders.map((o) => ({ id: o.id, orderNumber: o.orderNumber })),
        },
        { status: 502 }
      )
    }

    const piId = paymentIntent.id
    const piSucceeded = paymentIntent.status === 'succeeded'

    // Stamp the PI id on every order so the webhook can find them.
    try {
      await prisma.order.updateMany({
        where: { id: { in: createdOrders.map((o) => o.id) } },
        data: {
          paymentIntentId: piId,
          paymentStatus: piSucceeded ? 'succeeded' : 'processing',
          paidAt: piSucceeded ? new Date() : null,
        },
      })
    } catch (updErr) {
      console.error('Batch: failed to stamp PI on orders. Webhook will not find them:', updErr)
      // Don't fail the response — the customer's charge is real; the orders
      // exist; only the linkage failed. The webhook will log "no orders found"
      // and operations can reconcile from the audit log.
    }

    console.log(
      `Batch order placed: ${createdOrders.length} orders, $${grandTotal.toFixed(2)} total, PI ${piId} status=${paymentIntent.status}`
    )

    // Audit each surcharge that landed on a successfully-created order.
    for (let i = 0; i < createdOrders.length; i++) {
      const sa = computed[i].serviceArea
      if (sa.tier === 'surcharge' && sa.decidedBy) {
        await audit({
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: AuditAction.ServiceAreaSurchargeApplied,
          targetType: 'order',
          targetId: createdOrders[i].id,
          metadata: {
            centerId: sa.decidedBy.centerId,
            centerName: sa.decidedBy.centerName,
            driveTimeMinutes: sa.decidedBy.driveTimeMinutes,
            surchargeCents: sa.surchargeCents,
            zip: computed[i].orderBody.property_zip,
          },
          request,
        })
      }
    }

    // Synchronously send confirmation + admin notification for each order whose
    // payment already succeeded. Prior to this, batch checkout relied entirely
    // on the payment_intent.succeeded webhook for emails — but webhook delivery
    // can lag or silently fail (esp. for admin team accounts whose orders
    // never trigger the single-order POST path). Reservation flag stops the
    // webhook from double-sending if it arrives later.
    if (piSucceeded) {
      for (const co of createdOrders) {
        const reserved = await prisma.order.updateMany({
          where: { id: co.id, confirmationEmailSentAt: null },
          data: { confirmationEmailSentAt: new Date() },
        })
        if (reserved.count === 0) continue
        try {
          const full = await prisma.order.findUnique({
            where: { id: co.id },
            include: { orderItems: true, user: true, postType: { select: { name: true } } },
          })
          if (!full) continue
          const assignedAgent = await resolveAssignedAgent({
            placedForAgentName: full.placedForAgentName,
            teamId: full.user.teamId,
          })
          await Promise.all([
            sendOrderConfirmationEmail({
              customerName: full.user.fullName || full.user.name || '',
              customerEmail: full.user.email,
              orderNumber: full.orderNumber,
              propertyAddress: `${full.propertyAddress}, ${full.propertyCity}, ${full.propertyState} ${full.propertyZip}`,
              total: Number(full.total),
              items: full.orderItems.map((it) => ({
                description: it.description,
                quantity: it.quantity,
                total_price: Number(it.totalPrice),
              })),
              requestedDate: full.scheduledDate?.toISOString(),
              installationNotes: full.propertyNotes || undefined,
              // Pref gate — order recipient is the order's userId.
              recipientUserId: full.userId,
            }),
            sendAdminOrderNotification({
              orderNumber: full.orderNumber,
              customerName: full.user.fullName || full.user.name || '',
              customerEmail: full.user.email,
              customerPhone: full.user.phone || '',
              propertyAddress: `${full.propertyAddress}, ${full.propertyCity}, ${full.propertyState} ${full.propertyZip}`,
              total: Number(full.total),
              items: full.orderItems.map((it) => ({
                description: it.description,
                quantity: it.quantity,
                total_price: Number(it.totalPrice),
              })),
              requestedDate: full.scheduledDate?.toISOString(),
              isExpedited: full.isExpedited,
              // Pass postType so the email shows the real post (e.g. "Black
              // Vinyl Post") instead of falling through to the "None
              // (service trip only)" default. Real service trips have
              // postType=null and correctly land on the default copy.
              postType: full.postType?.name || undefined,
              installationNotes: full.propertyNotes || undefined,
              installationLocation: full.installationLocation || undefined,
              isGatedCommunity: full.isGatedCommunity,
              gateCode: full.gateCode || undefined,
              hasMarkerPlaced: full.hasMarkerPlaced,
              signOrientation: full.signOrientation || undefined,
              signOrientationOther: full.signOrientationOther || undefined,
              subtotal: Number(full.subtotal),
              discount: Number(full.discount),
              fuelSurcharge: Number(full.fuelSurcharge),
              noPostSurcharge: Number(full.noPostSurcharge),
              expediteFee: Number(full.expediteFee),
              tax: Number(full.tax),
              assignedAgentName: assignedAgent?.name ?? null,
              assignedAgentPhone: assignedAgent?.phone ?? null,
            }),
          ])
        } catch (emailError) {
          console.error(`Batch: failed to send emails for order ${co.orderNumber}:`, emailError)
          // Release the reservation so the webhook (or manual replay) can retry.
          await prisma.order.updateMany({
            where: { id: co.id, confirmationEmailSentAt: { not: null } },
            data: { confirmationEmailSentAt: null },
          }).catch(() => {})
        }
      }
    }

    try {
      await audit({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: AuditAction.CartCheckoutSucceed,
        targetType: 'cart',
        targetId: cartSessionId,
        metadata: {
          orderIds: createdOrders.map((o) => o.id),
          orderCount: createdOrders.length,
          grandTotal,
          paymentIntentId: piId,
          paymentStatus: paymentIntent.status,
        },
        request,
      })
    } catch (auditErr) {
      // Audit must never break the response. Orders exist, PI succeeded —
      // the user gets their confirmation.
      console.error('Batch: failed to audit success:', auditErr)
    }

    return NextResponse.json({
      status: paymentIntent.status, // 'succeeded' | 'requires_action' | etc.
      client_secret: paymentIntent.client_secret,
      grand_total: grandTotal,
      orders: createdOrders,
    })
  } catch (error) {
    console.error('Batch order error:', error)
    const stripeMessage = getStripeErrorMessage(error)
    if (stripeMessage) {
      return NextResponse.json({ error: stripeMessage }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Something went wrong placing the batch. Please try again.' },
      { status: 500 }
    )
  }
}
