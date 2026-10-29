import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listPaymentMethods, stripe } from '@/lib/stripe'

// GET /api/stripe/payment-methods - List all payment methods for user
export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { stripeCustomerId: true },
    })

    if (!user?.stripeCustomerId) {
      return NextResponse.json({ paymentMethods: [] })
    }

    // Get payment methods from Stripe
    const stripePaymentMethods = await listPaymentMethods(user.stripeCustomerId)

    // Get customer to check default payment method
    const customer = await stripe.customers.retrieve(user.stripeCustomerId)
    const defaultPaymentMethodId =
      customer && 'invoice_settings' in customer
        ? customer.invoice_settings?.default_payment_method
        : null

    // Get local payment methods for default status
    const localPaymentMethods = await prisma.paymentMethod.findMany({
      where: { userId: session.user.id },
      select: { stripePaymentMethodId: true, isDefault: true, nickname: true },
    })

    const localDefaults = new Map(
      localPaymentMethods.map((pm) => [pm.stripePaymentMethodId, pm.isDefault])
    )
    const nicknames = new Map(localPaymentMethods.map((pm) => [pm.stripePaymentMethodId, pm.nickname]))

    // Format response
    const paymentMethods = stripePaymentMethods.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand || 'unknown',
      last4: pm.card?.last4 || '****',
      expMonth: pm.card?.exp_month || 0,
      expYear: pm.card?.exp_year || 0,
      isDefault: pm.id === defaultPaymentMethodId || localDefaults.get(pm.id) || false,
      nickname: nicknames.get(pm.id) ?? null,
    }))

    return NextResponse.json({ paymentMethods })
  } catch (error) {
    console.error('Error fetching payment methods:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payment methods' },
      { status: 500 }
    )
  }
}

// POST /api/stripe/payment-methods - Save a payment method after SetupIntent confirms
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { paymentMethodId } = await request.json()

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'Payment method ID is required' },
        { status: 400 }
      )
    }

    // Get user's Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { stripeCustomerId: true },
    })

    if (!user?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No Stripe customer found' },
        { status: 400 }
      )
    }

    // Get payment method details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)

    // Check if this is the first payment method
    const existingMethods = await prisma.paymentMethod.count({
      where: { userId: session.user.id },
    })

    const isFirst = existingMethods === 0

    // Save to database
    await prisma.paymentMethod.upsert({
      where: { stripePaymentMethodId: paymentMethodId },
      create: {
        userId: session.user.id,
        stripePaymentMethodId: paymentMethodId,
        brand: paymentMethod.card?.brand || 'unknown',
        last4: paymentMethod.card?.last4 || '****',
        expMonth: paymentMethod.card?.exp_month || 0,
        expYear: paymentMethod.card?.exp_year || 0,
        isDefault: isFirst,
      },
      update: {
        brand: paymentMethod.card?.brand || 'unknown',
        last4: paymentMethod.card?.last4 || '****',
        expMonth: paymentMethod.card?.exp_month || 0,
        expYear: paymentMethod.card?.exp_year || 0,
      },
    })

    // If first payment method, set as default in Stripe too
    if (isFirst) {
      await stripe.customers.update(user.stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving payment method:', error)
    return NextResponse.json(
      { error: 'Failed to save payment method' },
      { status: 500 }
    )
  }
}
