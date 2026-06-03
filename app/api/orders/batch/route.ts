import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, generateOrderNumber } from '@/lib/auth-utils'
import { createPaymentIntent, createCustomer, getStripeErrorMessage, stripe } from '@/lib/stripe/server'
import { computeOrderPricing } from '@/lib/orders/pricing'
import { claimHoldsInTx, HoldConflictError, type HoldClaim } from '@/lib/inventory-holds'
import { audit, AuditAction } from '@/lib/audit'
import type { HoldItemType } from '@prisma/client'

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

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ error: 'Batch must contain at least one order' }, { status: 400 })
    }
    if (!paymentMethodId) {
      return NextResponse.json({ error: 'payment_method_id is required' }, { status: 400 })
    }

    // ---- Step 1: validate and compute pricing for each order ----
    type Computed = {
      orderBody: BatchOrderBody
      pricing: ReturnType<typeof computeOrderPricing>
      postTypeId: string | null
      // Holds claimed during checkout (one entry per item that came with a hold_id).
      claims: HoldClaim[]
    }
    const computed: Computed[] = []

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i]
      if (!o.items || o.items.length === 0) {
        return NextResponse.json({ error: `Order ${i + 1} has no items` }, { status: 400 })
      }
      if (!o.property_address || !o.property_city || !o.property_zip || !o.property_type) {
        return NextResponse.json({ error: `Order ${i + 1} is missing a required property field` }, { status: 400 })
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

      const pricing = computeOrderPricing({
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

      computed.push({ orderBody: o, pricing, postTypeId, claims })
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
    let stripeCustomerId = actor.stripeCustomerId
    if (!stripeCustomerId) {
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

    // ---- Step 3: create ONE PaymentIntent for the combined total ----
    let paymentIntent
    try {
      paymentIntent = await createPaymentIntent(grandTotal, stripeCustomerId, paymentMethodId)
    } catch (err) {
      console.error('Batch: payment intent creation failed:', err)
      return NextResponse.json(
        { error: getStripeErrorMessage(err) || 'Payment failed. Please check your card details and try again.' },
        { status: 400 }
      )
    }

    // ---- Step 4: create all orders in a transaction, sharing the PI ----
    const piId = paymentIntent.id
    const piSucceeded = paymentIntent.status === 'succeeded'

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
              expediteFee: c.pricing.expediteFee,
              discount: c.pricing.discount,
              tax: c.pricing.tax,
              total: c.pricing.total,
              paymentIntentId: piId,
              paymentStatus: piSucceeded ? 'succeeded' : 'processing',
              paidAt: piSucceeded ? new Date() : null,
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
      // CRITICAL: cancel the PI so the customer is not charged for orders
      // that never existed. Swallow errors from cancel itself — never throw.
      try {
        await stripe().paymentIntents.cancel(piId, { cancellation_reason: 'abandoned' })
      } catch (cancelErr) {
        console.error('Batch: failed to cancel PI after tx rollback:', piId, cancelErr)
      }

      if (txError instanceof HoldConflictError) {
        // Redact holder identity if cross-team. The helper only puts
        // itemType/itemId/holdId in details — no holder name — so we just
        // re-emit code + details + a single-conflict shape consistent with
        // the prevalidate response.
        const conflict = {
          code: txError.code,
          item_type: (txError.details.itemType as HoldItemType) ?? null,
          item_id: (txError.details.itemId as string) ?? null,
          hold_id: (txError.details.holdId as string) ?? null,
        }
        await audit({
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: AuditAction.CartCheckoutFail,
          targetType: 'cart',
          targetId: cartSessionId,
          metadata: { stage: 'tx_claim', conflict, paymentIntentId: piId },
          request,
        })
        return NextResponse.json(
          { error: 'item_unavailable', code: 'hold_conflict', conflicts: [conflict] },
          { status: 409 }
        )
      }

      // Non-hold tx failure: audit + bubble to the outer catch as a 500.
      await audit({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: AuditAction.CartCheckoutFail,
        targetType: 'cart',
        targetId: cartSessionId,
        metadata: { stage: 'tx_other', paymentIntentId: piId, message: (txError as Error)?.message ?? null },
        request,
      })
      throw txError
    }

    console.log(
      `Batch order placed: ${createdOrders.length} orders, $${grandTotal.toFixed(2)} total, PI ${piId} status=${paymentIntent.status}`
    )

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
