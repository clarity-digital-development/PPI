import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, generateOrderNumber, canActOnBehalfOf } from '@/lib/auth-utils'
import { createOrderSchema } from '@/lib/validations'
import { validateScheduling } from '@/lib/scheduling'
import { audit, AuditAction } from '@/lib/audit'
import { createPaymentIntent, createCustomer, calculateTax, getStripeErrorMessage } from '@/lib/stripe/server'
import { sendOrderConfirmationEmail, sendAdminOrderNotification } from '@/lib/email'
import { resolveServiceArea } from '@/lib/service-area'

const FUEL_SURCHARGE = 2.47
const NO_POST_SURCHARGE = 40
const FALLBACK_TAX_RATE = 0.06 // Fallback Kentucky 6% sales tax if Stripe Tax unavailable

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const agent = searchParams.get('agent') // team_admin: filter by placed-for agent name
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // team_admins see orders they own AND orders they placed on behalf of an
    // agent (placedByUserId). Regular customers see only their own.
    const ownership =
      user.role === 'team_admin'
        ? { OR: [{ userId: user.id }, { placedByUserId: user.id }] }
        : { userId: user.id }

    const orders = await prisma.order.findMany({
      where: {
        ...ownership,
        ...(status ? { status: status as any } : {}),
        ...(agent ? { placedForAgentName: agent } : {}),
      },
      include: {
        orderItems: true,
        postType: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })

    return NextResponse.json({ orders })
  } catch (error) {
    console.error('Error fetching orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // If an admin or team_admin is placing an order on behalf of an agent,
    // the order's `userId` is the agent (so it shows in their account, their
    // inventory tracks correctly, etc.) but the Stripe customer + payment
    // method are the actor's (so they get charged).
    //
    // `user` below = the customer/agent who OWNS the order (= actor when
    // self-placing). `payer` = whoever's card is charged (= actor always).
    const onBehalfOfUserId: string | undefined = body.on_behalf_of_user_id
    let user = actor
    const payer = actor
    let placedByUserId: string | null = null
    if (onBehalfOfUserId && onBehalfOfUserId !== actor.id) {
      if (!(await canActOnBehalfOf(actor, onBehalfOfUserId))) {
        return NextResponse.json({ error: 'Forbidden — cannot place order for this user' }, { status: 403 })
      }
      const agent = await prisma.user.findUnique({ where: { id: onBehalfOfUserId } })
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
      }
      user = agent
      placedByUserId = actor.id
    }

    const validationResult = createOrderSchema.safeParse(body)

    if (!validationResult.success) {
      // Log the validation errors and request body for debugging
      console.error('Order validation failed:', JSON.stringify(validationResult.error.errors, null, 2))
      console.error('Request body keys:', Object.keys(body))

      // Build a user-friendly error message from validation errors
      const fieldErrors = validationResult.error.errors.map(e => {
        const field = e.path.join('.')
        if (field === 'items' && e.code === 'too_small') return 'At least one item is required'
        if (field === 'property_address') return 'Street address is required'
        if (field === 'property_city') return 'City is required'
        if (field === 'property_zip') return 'ZIP code is required'
        if (field === 'property_type') return 'Property type is required'
        if (field.startsWith('items.')) return `Order item issue: ${e.message}`
        return `${field}: ${e.message}`
      })
      const message = fieldErrors.length === 1
        ? fieldErrors[0]
        : `Please fix the following: ${fieldErrors.join('; ')}`

      return NextResponse.json(
        { error: message, details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const orderData = validationResult.data

    // Server-side schedule gate. The wizard's date picker min= is purely
    // client-side; without this, a stale tab or dev-tools edit can submit
    // a past-cutoff date and get a same-day install booked at 10pm.
    const scheduleCheck = validateScheduling({
      requestedDate: orderData.requested_date,
      isExpedited: orderData.is_expedited,
    })
    if (!scheduleCheck.ok) {
      return NextResponse.json(
        { error: scheduleCheck.error, code: scheduleCheck.code },
        { status: 400 }
      )
    }

    // Service-area gate. Payer (actor) gets the exemption per Ryan — they're
    // the wallet. team_admin and isServiceAreaExempt customers always pass.
    const effectiveUser = {
      id: actor.id,
      role: actor.role,
      isServiceAreaExempt: actor.isServiceAreaExempt ?? false,
    }
    const sa = await resolveServiceArea({ zip: orderData.property_zip, user: effectiveUser })
    if (sa.tier === 'out_of_area') {
      await audit({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: AuditAction.ServiceAreaBlock,
        targetType: 'order',
        metadata: {
          zip: orderData.property_zip,
          reason: sa.reason ?? null,
          attemptedTotal: orderData.items.reduce((s, i) => s + i.total_price, 0),
          centersChecked: 5,
        },
        request,
      })
      return NextResponse.json(
        {
          error: `We don't currently service ZIP ${orderData.property_zip}. Please call ${sa.contactPhone} to discuss options.`,
          code: 'service_area_unavailable',
          contactPhone: sa.contactPhone,
        },
        { status: 400 }
      )
    }
    // surcharge → push a synthetic OrderItem so it flows through pricing + display.
    if (sa.tier === 'surcharge' && sa.decidedBy) {
      const surchargeDollars = sa.surchargeCents / 100
      orderData.items.push({
        // Server-injected: 'surcharge' is intentionally NOT in the client Zod enum
        // (clients can't fake a $0 surcharge line). The outer object cast widens to the
        // route's items[] union; this property cast bridges through `any`.
        item_type: 'surcharge' as never,
        item_category: undefined,
        description: `Out-of-area service fee – ${sa.decidedBy.centerName} ~${Math.round(sa.decidedBy.driveTimeMinutes)}min`,
        quantity: 1,
        unit_price: surchargeDollars,
        total_price: surchargeDollars,
      } as typeof orderData.items[number])
    }

    // Calculate totals
    const subtotal = orderData.items.reduce((sum, item) => sum + item.total_price, 0)
    // Discountable subtotal excludes brochure box purchases (they should not be discounted)
    const discountableSubtotal = orderData.items
      .filter(item => !(item.item_type === 'brochure_box' && item.item_category === 'purchase'))
      .reduce((sum, item) => sum + item.total_price, 0)
    const expediteFee = orderData.is_expedited ? 50 : 0

    // Handle promo code discount
    let discount = 0
    let promoCodeId: string | undefined = undefined
    let fuelSurchargeWaived = false
    if (orderData.promo_code_id) {
      const promoCode = await prisma.promoCode.findUnique({
        where: { id: orderData.promo_code_id },
      })
      if (promoCode && promoCode.isActive) {
        // Check per-customer usage before applying
        const maxUsesPerCustomer = promoCode.maxUses ?? 1
        const userUsageCount = await prisma.promoCodeUsage.count({
          where: {
            userId: user.id,
            promoCodeId: promoCode.id,
          },
        })
        if (userUsageCount >= maxUsesPerCustomer) {
          return NextResponse.json({ error: 'You have already used this promo code' }, { status: 400 })
        }

        // Validate and calculate discount (only on discountable items - excludes brochure box purchases)
        if (promoCode.discountType === 'percentage') {
          discount = discountableSubtotal * (Number(promoCode.discountValue) / 100)
        } else {
          discount = Math.min(Number(promoCode.discountValue), discountableSubtotal)
        }
        discount = Math.round(discount * 100) / 100
        promoCodeId = promoCode.id
        fuelSurchargeWaived = promoCode.waiveFuelSurcharge

        // NOTE: Usage is recorded AFTER order creation succeeds (below)
      }
    }

    const noPostSurcharge = !orderData.post_type ? NO_POST_SURCHARGE : 0
    const actualFuelSurcharge = fuelSurchargeWaived ? 0 : FUEL_SURCHARGE
    const discountedSubtotal = Math.max(0, subtotal - discount)
    const taxableAmount = discountedSubtotal + expediteFee + noPostSurcharge // Fuel surcharge typically not taxed

    // Calculate tax using Stripe Tax (with fallback to hardcoded rate)
    let tax = 0
    let taxCalculationMethod = 'fallback'

    try {
      // Build line items for Stripe Tax calculation
      const taxLineItems = orderData.items.map((item, index) => ({
        amount: Math.round(item.total_price * 100), // Convert to cents
        reference: `item_${index}_${item.item_type}`,
        // Use general services tax code - Stripe will apply appropriate rate
        tax_code: 'txcd_99999999',
      }))

      // Add expedite fee as a line item if applicable
      if (expediteFee > 0) {
        taxLineItems.push({
          amount: Math.round(expediteFee * 100),
          reference: 'expedite_fee',
          tax_code: 'txcd_99999999',
        })
      }

      // Apply discount proportionally (reduce first item amount for simplicity)
      if (discount > 0 && taxLineItems.length > 0) {
        const discountCents = Math.round(discount * 100)
        taxLineItems[0].amount = Math.max(0, taxLineItems[0].amount - discountCents)
      }

      const taxResult = await calculateTax(taxLineItems, {
        line1: orderData.property_address,
        city: orderData.property_city,
        state: orderData.property_state || 'KY',
        postal_code: orderData.property_zip,
        country: 'US',
      })

      const stripeTax = taxResult.taxAmountExclusive / 100 // Convert back from cents

      // If Stripe Tax returns 0 (e.g., services classified as non-taxable), use fallback
      // Pink Posts charges 6% on all orders as a business decision
      if (stripeTax > 0) {
        tax = stripeTax
        taxCalculationMethod = 'stripe_tax'
        console.log('Stripe Tax calculated:', { tax, breakdown: taxResult.taxBreakdown })
      } else {
        tax = Math.round(taxableAmount * FALLBACK_TAX_RATE * 100) / 100
        taxCalculationMethod = 'fallback'
        console.log('Stripe Tax returned 0, using fallback:', { tax })
      }
    } catch (taxError) {
      // Fallback to manual calculation if Stripe Tax fails
      console.warn('Stripe Tax calculation failed, using fallback rate:', taxError)
      tax = Math.round(taxableAmount * FALLBACK_TAX_RATE * 100) / 100
      taxCalculationMethod = 'fallback'
    }

    const total = discountedSubtotal + actualFuelSurcharge + expediteFee + noPostSurcharge + tax

    // Create or get Stripe customer — always the payer (who is charged),
    // never the agent. For on-behalf-of orders this means the team_admin's
    // Stripe customer.
    let stripeCustomerId = payer.stripeCustomerId
    if (!stripeCustomerId) {
      try {
        const stripeCustomer = await createCustomer(payer.email, payer.fullName || payer.name || '')
        stripeCustomerId = stripeCustomer.id

        await prisma.user.update({
          where: { id: payer.id },
          data: { stripeCustomerId },
        })
      } catch (customerError) {
        console.error('Error creating Stripe customer:', customerError)
        const friendlyMessage = getStripeErrorMessage(customerError)
        return NextResponse.json(
          { error: friendlyMessage || 'Unable to set up payment. Please try again or contact support.' },
          { status: 400 }
        )
      }
    }

    // Create payment intent (skip for $0 orders - fully discounted)
    let paymentIntent: { id: string; status: string; client_secret: string | null } | null = null
    if (total > 0) {
      try {
        paymentIntent = await createPaymentIntent(
          total,
          stripeCustomerId,
          orderData.payment_method_id
        )
      } catch (paymentError) {
        console.error('Payment intent creation failed:', paymentError)
        const friendlyMessage = getStripeErrorMessage(paymentError)
        // Forensic trail — without this row, debugging a customer's failed
        // checkout requires logs we may not retain. This was the gap that
        // hid the round-5 createPaymentIntent regression for ~18h.
        try {
          await audit({
            actor: { id: actor.id, email: actor.email, role: actor.role },
            action: AuditAction.CartCheckoutFail,
            targetType: 'order',
            targetId: null,
            metadata: {
              stage: 'single_pi_create',
              total,
              payment_method_id: orderData.payment_method_id ?? null,
              stripe_message: friendlyMessage ?? (paymentError instanceof Error ? paymentError.message : String(paymentError)),
            },
            request,
          })
        } catch {}
        return NextResponse.json(
          { error: friendlyMessage || 'Payment failed. Please check your card details and try again.' },
          { status: 400 }
        )
      }
    }

    // Get the post type (optional - orders can be for other services only)
    // open_house is handled as no-post (wire frames are the service)
    let postTypeId: string | null = null
    if (orderData.post_type && orderData.post_type !== 'open_house') {
      console.log('Looking up post type:', orderData.post_type)
      const postType = await prisma.postType.findFirst({
        where: { name: orderData.post_type },
      })

      if (!postType) {
        console.error('Post type not found:', orderData.post_type)
        // List available post types for debugging
        const availableTypes = await prisma.postType.findMany({ select: { name: true } })
        console.error('Available post types:', availableTypes.map(t => t.name))
        return NextResponse.json({ error: `Invalid post type: ${orderData.post_type}` }, { status: 400 })
      }
      console.log('Found post type:', postType.name, postType.id)
      postTypeId = postType.id
    } else {
      console.log('No post type selected (or open house) - order is for other services only')
    }

    // Validate property type before creating order
    const validPropertyTypes = ['residential', 'commercial', 'land', 'multi_family', 'house', 'construction', 'bare_land']
    if (!validPropertyTypes.includes(orderData.property_type)) {
      console.error('Invalid property type:', orderData.property_type)
      return NextResponse.json({ error: `Invalid property type: ${orderData.property_type}` }, { status: 400 })
    }
    console.log('Property type valid:', orderData.property_type)

    // Create order
    console.log('Creating order with data:', {
      postTypeId,
      propertyType: orderData.property_type,
      propertyAddress: orderData.property_address,
    })
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId: user.id,
        placedByUserId,
        // Team-admin-only field: free-text name of the agent who sold the
        // property. Trimmed; null if blank.
        placedForAgentName: (body.placed_for_agent_name ?? '').toString().trim() || null,
        postTypeId,
        propertyType: orderData.property_type as any,
        propertyAddress: orderData.property_address,
        propertyCity: orderData.property_city,
        propertyState: orderData.property_state || 'KY',
        propertyZip: orderData.property_zip,
        propertyNotes: orderData.installation_notes,
        installationLocationImage: orderData.installation_location_image,
        // Installation details
        isGatedCommunity: orderData.is_gated_community || false,
        gateCode: orderData.gate_code,
        hasMarkerPlaced: orderData.has_marker_placed || false,
        signOrientation: orderData.sign_orientation,
        signOrientationOther: orderData.sign_orientation_other,
        installationLocation: orderData.installation_location,
        scheduledDate: orderData.requested_date ? new Date(orderData.requested_date + 'T12:00:00Z') : null,
        isExpedited: orderData.is_expedited,
        subtotal,
        fuelSurcharge: actualFuelSurcharge,
        noPostSurcharge,
        expediteFee,
        discount,
        tax,
        total,
        promoCodeId,
        paymentIntentId: paymentIntent?.id || null,
        paymentStatus: !paymentIntent ? 'succeeded' : paymentIntent.status === 'succeeded' ? 'succeeded' : 'processing',
        orderItems: {
          create: orderData.items.map((item) => ({
            itemType: item.item_type,
            itemCategory: item.item_category,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            totalPrice: item.total_price,
            customerSignId: item.customer_sign_id,
            customerRiderId: item.customer_rider_id,
            customerLockboxId: item.customer_lockbox_id,
            customerBrochureBoxId: item.customer_brochure_box_id,
            customValue: item.custom_value,
          })),
        },
      },
      include: {
        orderItems: true,
      },
    })

    // Audit surcharge application now that the order row exists.
    if (sa.tier === 'surcharge' && sa.decidedBy) {
      await audit({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: AuditAction.ServiceAreaSurchargeApplied,
        targetType: 'order',
        targetId: order.id,
        metadata: {
          centerId: sa.decidedBy.centerId,
          centerName: sa.decidedBy.centerName,
          driveTimeMinutes: sa.decidedBy.driveTimeMinutes,
          surchargeCents: sa.surchargeCents,
          zip: orderData.property_zip,
        },
        request,
      })
    }

    // Mark inventory items as no longer in storage after order is created.
    // If payment later fails (3DS abandoned, card declined, etc.), the webhook
    // for payment_intent.payment_failed / canceled restores these items —
    // see app/api/webhooks/stripe/route.ts.
    const inventoryUpdates: Promise<unknown>[] = []
    for (const item of orderData.items) {
      if (item.customer_sign_id) {
        inventoryUpdates.push(
          prisma.customerSign.update({
            where: { id: item.customer_sign_id },
            data: { inStorage: false },
          })
        )
      }
      if (item.customer_rider_id) {
        inventoryUpdates.push(
          prisma.customerRider.update({
            where: { id: item.customer_rider_id },
            data: { inStorage: false },
          })
        )
      }
      if (item.customer_lockbox_id) {
        inventoryUpdates.push(
          prisma.customerLockbox.update({
            where: { id: item.customer_lockbox_id },
            data: { inStorage: false },
          })
        )
      }
      if (item.customer_brochure_box_id) {
        inventoryUpdates.push(
          prisma.customerBrochureBox.update({
            where: { id: item.customer_brochure_box_id },
            data: { inStorage: false },
          })
        )
      }
    }
    if (inventoryUpdates.length > 0) {
      await Promise.all(inventoryUpdates)
      console.log(`Marked ${inventoryUpdates.length} inventory item(s) as out of storage for order ${order.orderNumber}`)
    }

    // Record promo code usage AFTER order is successfully created
    if (promoCodeId) {
      await prisma.promoCodeUsage.create({
        data: {
          userId: user.id,
          promoCodeId,
        },
      })
    }

    // Send emails if payment succeeded (or order is free)
    const orderPaymentStatus = !paymentIntent ? 'succeeded' : paymentIntent.status
    console.log(`Order ${order.orderNumber} created, payment status: ${orderPaymentStatus}`)
    if (orderPaymentStatus === 'succeeded') {
      // Reserve the email slot first so the webhook (which also fires for this
      // PI) can't double-send. Whichever path wins the conditional update sends.
      const emailReserved = await prisma.order.updateMany({
        where: { id: order.id, confirmationEmailSentAt: null },
        data: { confirmationEmailSentAt: new Date() },
      })
      if (emailReserved.count > 0) {
        console.log(`Payment succeeded immediately, sending emails for order ${order.orderNumber}`)
        try {
          await Promise.all([
            sendOrderConfirmationEmail({
              customerName: user.fullName || user.name || '',
              customerEmail: user.email,
              orderNumber: order.orderNumber,
              propertyAddress: `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`,
              total: Number(order.total),
              items: orderData.items,
              requestedDate: orderData.requested_date,
              installationNotes: orderData.installation_notes || undefined,
              // Pref gate — checkout user is the recipient of the order confirmation.
              recipientUserId: user.id,
            }),
            sendAdminOrderNotification({
              orderNumber: order.orderNumber,
              customerName: user.fullName || user.name || '',
              customerEmail: user.email,
              customerPhone: user.phone || '',
              propertyAddress: `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`,
              total: Number(order.total),
              items: orderData.items,
              requestedDate: orderData.requested_date,
              isExpedited: orderData.is_expedited,
              propertyType: orderData.property_type,
              postType: orderData.post_type || undefined,
              installationNotes: orderData.installation_notes || undefined,
              installationLocation: orderData.installation_location || undefined,
              isGatedCommunity: orderData.is_gated_community,
              gateCode: orderData.gate_code || undefined,
              hasMarkerPlaced: orderData.has_marker_placed,
              signOrientation: orderData.sign_orientation || undefined,
              signOrientationOther: orderData.sign_orientation_other || undefined,
              subtotal,
              discount,
              promoCode: orderData.promo_code || undefined,
              fuelSurcharge: actualFuelSurcharge,
              noPostSurcharge,
              expediteFee,
              tax,
            }),
          ])
          console.log(`Emails sent successfully for order ${order.orderNumber}`)
        } catch (emailError) {
          console.error(`Error sending emails for order ${order.orderNumber}:`, emailError)
          // Roll back the reservation so the webhook (or a manual replay) can retry.
          await prisma.order.updateMany({
            where: { id: order.id, confirmationEmailSentAt: { not: null } },
            data: { confirmationEmailSentAt: null },
          }).catch(() => {})
        }
      } else {
        console.log(`Order ${order.orderNumber}: confirmation email already reserved (webhook beat us) — skipping send`)
      }
    } else {
      console.log(`Payment not immediately succeeded (status: ${orderPaymentStatus}), emails will be sent via webhook`)
    }

    return NextResponse.json({
      order,
      clientSecret: paymentIntent?.client_secret || null,
      paymentStatus: orderPaymentStatus,
    })
  } catch (error) {
    console.error('Error creating order:', error)

    // Check if it's a Stripe error that slipped through
    const stripeMessage = getStripeErrorMessage(error)
    if (stripeMessage) {
      return NextResponse.json({ error: stripeMessage }, { status: 400 })
    }

    // For other errors, return a helpful message
    return NextResponse.json(
      { error: 'Something went wrong while placing your order. Please try again or contact support if the issue persists.' },
      { status: 500 }
    )
  }
}
