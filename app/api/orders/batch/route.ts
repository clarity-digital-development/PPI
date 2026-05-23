import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, generateOrderNumber } from '@/lib/auth-utils'
import { createPaymentIntent, createCustomer, getStripeErrorMessage } from '@/lib/stripe/server'
import { computeOrderPricing } from '@/lib/orders/pricing'

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
  }>
  requested_date?: string
  is_expedited?: boolean
  placed_for_agent_name?: string
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
      computed.push({ orderBody: o, pricing, postTypeId })
    }

    const grandTotal = computed.reduce((sum, c) => sum + c.pricing.total, 0)
    if (grandTotal <= 0) {
      return NextResponse.json({ error: 'Batch total must be greater than $0' }, { status: 400 })
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

    const createdOrders = await prisma.$transaction(async (tx) => {
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

        // Mark linked inventory as out-of-storage for this order (same as the
        // single-order POST does). If payment later fails, the webhook
        // restores it via restoreOrderInventory.
        const invUpdates: Promise<unknown>[] = []
        for (const item of o.items) {
          if (item.customer_sign_id)
            invUpdates.push(tx.customerSign.update({ where: { id: item.customer_sign_id }, data: { inStorage: false } }))
          if (item.customer_rider_id)
            invUpdates.push(tx.customerRider.update({ where: { id: item.customer_rider_id }, data: { inStorage: false } }))
          if (item.customer_lockbox_id)
            invUpdates.push(tx.customerLockbox.update({ where: { id: item.customer_lockbox_id }, data: { inStorage: false } }))
          if (item.customer_brochure_box_id)
            invUpdates.push(tx.customerBrochureBox.update({ where: { id: item.customer_brochure_box_id }, data: { inStorage: false } }))
        }
        if (invUpdates.length) await Promise.all(invUpdates)
      }
      return out
    })

    console.log(
      `Batch order placed: ${createdOrders.length} orders, $${grandTotal.toFixed(2)} total, PI ${piId} status=${paymentIntent.status}`
    )

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
