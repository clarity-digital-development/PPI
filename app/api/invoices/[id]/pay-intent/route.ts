import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { createCustomer, createPaymentIntent, getStripeErrorMessage } from '@/lib/stripe/server'

/**
 * Create (or reuse) a PaymentIntent for an invoice. Returns clientSecret so
 * the customer's browser can confirm via the embedded Stripe Payment Element.
 *
 * Idempotency: once a PI has been created for the invoice, we return the same
 * one. Stripe-side dedup also protects via the invoice-id idempotency key so
 * concurrent calls converge on a single PI.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { user: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (invoice.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (invoice.status !== 'sent') {
    return NextResponse.json(
      { error: invoice.status === 'paid' ? 'This invoice has already been paid.' : 'This invoice has been voided.' },
      { status: 400 },
    )
  }

  // Lazily create a Stripe customer for the invoice payer — invoice-billing
  // accounts may have never paid through Stripe before, so they might not
  // have a customer id yet.
  let stripeCustomerId = invoice.user.stripeCustomerId
  if (!stripeCustomerId) {
    try {
      const c = await createCustomer(invoice.user.email, invoice.user.fullName || invoice.user.name || '')
      stripeCustomerId = c.id
      await prisma.user.update({ where: { id: invoice.user.id }, data: { stripeCustomerId } })
    } catch (err) {
      console.error('Invoice pay-intent: Stripe customer create failed:', err)
      return NextResponse.json(
        { error: getStripeErrorMessage(err) || 'Unable to set up payment. Please try again.' },
        { status: 400 },
      )
    }
  }

  let pi
  try {
    pi = await createPaymentIntent(Number(invoice.total), stripeCustomerId, undefined, {
      // Stripe dedupes by this key for 24h — concurrent or replayed calls all
      // collapse onto the same PI so we can't ever double-charge an invoice.
      idempotencyKey: `invoice:${invoice.id}`,
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, kind: 'invoice' },
    })
  } catch (err) {
    console.error('Invoice pay-intent: PI create failed:', err)
    return NextResponse.json(
      { error: getStripeErrorMessage(err) || 'Could not initialize payment.' },
      { status: 400 },
    )
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { paymentIntentId: pi.id },
  })

  return NextResponse.json({
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    total: Number(invoice.total),
  })
}
