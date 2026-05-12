import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { stripe, getStripeErrorMessage } from '@/lib/stripe/server'

// GET: Returns the current Stripe payment intent state for this order so the
// client can resume a stalled 3D Secure challenge. Owner-only (the customer who
// placed the order, or an admin).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        paymentStatus: true,
        paymentIntentId: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.userId !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (order.paymentStatus === 'succeeded') {
      return NextResponse.json({ status: 'succeeded', requires_action: false })
    }

    if (!order.paymentIntentId) {
      return NextResponse.json({
        status: 'no_payment_intent',
        requires_action: false,
        error: 'No payment intent associated with this order. Please place the order again.',
      })
    }

    const paymentIntent = await stripe().paymentIntents.retrieve(order.paymentIntentId)

    return NextResponse.json({
      status: paymentIntent.status,
      requires_action: paymentIntent.status === 'requires_action',
      client_secret: paymentIntent.status === 'requires_action' ? paymentIntent.client_secret : null,
    })
  } catch (error) {
    console.error('Error retrieving payment intent for retry:', error)
    const message = getStripeErrorMessage(error)
    return NextResponse.json(
      { error: message || 'Could not load payment status. Please try again.' },
      { status: 500 }
    )
  }
}

// POST: Sync the order's paymentStatus with Stripe after the client completed
// (or aborted) the 3DS challenge. The webhook is the source of truth for
// `succeeded`, but this gives the UI an immediate read so the user sees the
// updated state without waiting for the webhook round-trip.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, userId: true, paymentIntentId: true, paymentStatus: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.userId !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!order.paymentIntentId) {
      return NextResponse.json({ error: 'No payment intent on this order' }, { status: 400 })
    }

    const paymentIntent = await stripe().paymentIntents.retrieve(order.paymentIntentId)

    // Map Stripe payment-intent status to our Prisma PaymentStatus enum
    // (pending | processing | succeeded | failed | refunded)
    let newStatus: 'pending' | 'processing' | 'succeeded' | 'failed' | null = null
    if (paymentIntent.status === 'succeeded') {
      newStatus = 'succeeded'
    } else if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'canceled') {
      newStatus = 'failed'
    } else if (paymentIntent.status === 'processing') {
      newStatus = 'processing'
    } else if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_confirmation') {
      // Customer still needs to complete a step — keep as pending so the
      // Complete Payment banner remains visible on the order detail page
      newStatus = 'pending'
    }

    if (newStatus && newStatus !== order.paymentStatus) {
      await prisma.order.update({
        where: { id },
        data: {
          paymentStatus: newStatus,
          ...(newStatus === 'succeeded' ? { paidAt: new Date() } : {}),
        },
      })
    }

    return NextResponse.json({
      status: paymentIntent.status,
      paymentStatus: newStatus ?? order.paymentStatus,
    })
  } catch (error) {
    console.error('Error syncing payment status:', error)
    const message = getStripeErrorMessage(error)
    return NextResponse.json(
      { error: message || 'Could not sync payment status. Please refresh and try again.' },
      { status: 500 }
    )
  }
}
