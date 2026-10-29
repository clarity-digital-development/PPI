import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

const MAX_NICKNAME = 40

// PUT /api/stripe/payment-methods/[id]/nickname — { nickname } names a saved
// card ("Ashley's card") so a broker with several agents' cards can tell them
// apart without memorizing last-4s (Ryan, 2026-10-26). Blank clears it. Only
// the card's owner can name it.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const { id: paymentMethodId } = await params
    const body = await request.json().catch(() => ({}))
    if (typeof body?.nickname !== 'string') {
      return NextResponse.json({ error: 'Enter a nickname.' }, { status: 400 })
    }
    const nickname = body.nickname.trim().slice(0, MAX_NICKNAME) || null

    const existing = await prisma.paymentMethod.findUnique({
      where: { stripePaymentMethodId: paymentMethodId },
      select: { id: true, userId: true },
    })
    if (existing) {
      if (existing.userId !== userId) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 })
      }
      await prisma.paymentMethod.update({ where: { id: existing.id }, data: { nickname } })
      return NextResponse.json({ nickname })
    }

    // The Billing page lists cards straight from Stripe, so a card can be
    // there without a row here. Name it only if Stripe says it's this
    // customer's card, and keep the row so checkout shows it too.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } })
    if (!user?.stripeCustomerId) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null)
    const customerId = typeof pm?.customer === 'string' ? pm.customer : pm?.customer?.id
    if (!pm || pm.type !== 'card' || !pm.card || customerId !== user.stripeCustomerId) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }
    // The unique stripe id makes a concurrent save land on one row; that row
    // can only be this customer's (no row existed a moment ago).
    await prisma.paymentMethod.upsert({
      where: { stripePaymentMethodId: paymentMethodId },
      create: {
        userId,
        stripePaymentMethodId: paymentMethodId,
        brand: pm.card.brand || 'unknown',
        last4: pm.card.last4 || '****',
        expMonth: pm.card.exp_month || 0,
        expYear: pm.card.exp_year || 0,
        isDefault: false,
        nickname,
      },
      update: { nickname },
    })
    return NextResponse.json({ nickname })
  } catch (error) {
    console.error('Error naming payment method:', error)
    return NextResponse.json({ error: 'Failed to save the nickname' }, { status: 500 })
  }
}
