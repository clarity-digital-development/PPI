import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import {
  createCustomer,
  attachPaymentMethod,
  setDefaultPaymentMethod,
} from '@/lib/stripe/server'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })

    // Transform to expected format for frontend
    const transformedMethods = paymentMethods.map((pm) => ({
      id: pm.stripePaymentMethodId,
      card_brand: pm.brand,
      card_last4: pm.last4,
      is_default: pm.isDefault,
      nickname: pm.nickname,
    }))

    return NextResponse.json({ paymentMethods: transformedMethods })
  } catch (error) {
    console.error('Error fetching payment methods:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { payment_method_id, set_as_default } = body

    if (!payment_method_id) {
      return NextResponse.json(
        { error: 'Payment method ID is required' },
        { status: 400 }
      )
    }

    // Create Stripe customer if doesn't exist
    let stripeCustomerId = user.stripeCustomerId
    if (!stripeCustomerId) {
      const stripeCustomer = await createCustomer(user.email, user.fullName || user.name || '')
      stripeCustomerId = stripeCustomer.id

      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId },
      })
    }

    // Attach payment method to customer
    const paymentMethod = await attachPaymentMethod(payment_method_id, stripeCustomerId)

    // Check if first card
    const existingCount = await prisma.paymentMethod.count({
      where: { userId: user.id },
    })

    const isFirstCard = existingCount === 0
    const shouldSetDefault = set_as_default || isFirstCard

    if (shouldSetDefault) {
      await setDefaultPaymentMethod(stripeCustomerId, payment_method_id)

      // Clear other defaults
      await prisma.paymentMethod.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      })
    }

    // Save to database
    const savedMethod = await prisma.paymentMethod.create({
      data: {
        userId: user.id,
        stripePaymentMethodId: payment_method_id,
        brand: paymentMethod.card?.brand || 'unknown',
        last4: paymentMethod.card?.last4 || '0000',
        expMonth: paymentMethod.card?.exp_month || 0,
        expYear: paymentMethod.card?.exp_year || 0,
        isDefault: shouldSetDefault,
      },
    })

    return NextResponse.json({ paymentMethod: savedMethod }, { status: 201 })
  } catch (error) {
    console.error('Error saving payment method:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
