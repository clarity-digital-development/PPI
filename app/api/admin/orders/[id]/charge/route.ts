import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { createPaymentIntent, confirmPaymentIntent, getStripeErrorMessage } from '@/lib/stripe/server'
import { sendOrderConfirmationEmail, sendAdminOrderNotification } from '@/lib/email'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { payment_method_id } = body

    if (!payment_method_id) {
      return NextResponse.json({ error: 'Payment method ID is required' }, { status: 400 })
    }

    // Get the order with user info
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: true,
        orderItems: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.paymentStatus === 'succeeded') {
      return NextResponse.json({ error: 'Order already paid' }, { status: 400 })
    }

    if (!order.user.stripeCustomerId) {
      return NextResponse.json({ error: 'Customer has no Stripe account' }, { status: 400 })
    }

    try {
      let paymentIntent

      // If there's an existing payment intent, try to confirm it
      if (order.paymentIntentId) {
        paymentIntent = await confirmPaymentIntent(order.paymentIntentId, payment_method_id)
      } else {
        // Create and confirm a new payment intent
        paymentIntent = await createPaymentIntent(
          Number(order.total),
          order.user.stripeCustomerId,
          payment_method_id
        )
      }

      if (paymentIntent.status === 'succeeded') {
        // Update order payment status
        await prisma.order.update({
          where: { id },
          data: {
            paymentStatus: 'succeeded',
            paidAt: new Date(),
            paymentIntentId: paymentIntent.id,
          },
        })

        // Send confirmation emails
        try {
          await Promise.all([
            sendOrderConfirmationEmail({
              customerName: order.user.fullName || order.user.name || '',
              customerEmail: order.user.email,
              orderNumber: order.orderNumber,
              propertyAddress: `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`,
              total: Number(order.total),
              items: order.orderItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                total_price: Number(item.totalPrice),
              })),
            }),
            sendAdminOrderNotification({
              orderNumber: order.orderNumber,
              customerName: order.user.fullName || order.user.name || '',
              customerEmail: order.user.email,
              customerPhone: order.user.phone || '',
              propertyAddress: `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`,
              total: Number(order.total),
              items: order.orderItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                total_price: Number(item.totalPrice),
              })),
              isExpedited: order.isExpedited,
            }),
          ])
        } catch (emailError) {
          console.error('Error sending emails:', emailError)
        }

        return NextResponse.json({
          success: true,
          paymentStatus: 'succeeded',
        })
      } else if (paymentIntent.status === 'requires_action') {
        return NextResponse.json({
          success: false,
          error: 'Payment requires additional authentication',
          requires_action: true,
          client_secret: paymentIntent.client_secret,
        }, { status: 400 })
      } else {
        return NextResponse.json({
          success: false,
          error: `Payment failed with status: ${paymentIntent.status}`,
        }, { status: 400 })
      }
    } catch (stripeError) {
      console.error('Stripe error:', stripeError)
      const friendlyMessage = getStripeErrorMessage(stripeError)
      return NextResponse.json({
        error: friendlyMessage || 'Payment failed. Please check the card details and try again.',
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Error charging card:', error)
    const stripeMessage = getStripeErrorMessage(error)
    return NextResponse.json(
      { error: stripeMessage || 'Something went wrong while processing payment. Please try again.' },
      { status: 500 }
    )
  }
}
