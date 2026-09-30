import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { chargePaymentMethod } from '@/lib/stripe'
import { getStripeErrorMessage } from '@/lib/stripe/server'
import { createNotification } from '@/lib/notifications'

// POST /api/admin/service-requests/[id]/invoice
// Admin bills a variable amount for a service trip (they're not always a flat
// $40) by charging the customer's saved default card on file, off-session.
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
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Enter a valid charge amount.' }, { status: 400 })
    }

    const serviceRequest = await prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, name: true, stripeCustomerId: true, invoiceBilling: true },
        },
        // The removal's order — for the out-of-area pickup double-billing
        // guard below.
        installation: {
          select: {
            order: {
              select: {
                status: true,
                serviceAreaSecondChargeCents: true,
                serviceAreaSecondChargeStatus: true,
                serviceAreaSecondChargeInvoiceId: true,
                ooaPickupInvoice: { select: { invoiceNumber: true } },
              },
            },
          },
        },
      },
    })

    if (!serviceRequest) {
      return NextResponse.json({ error: 'Service request not found' }, { status: 404 })
    }
    if (serviceRequest.invoiceStatus === 'paid') {
      return NextResponse.json(
        { error: 'This request has already been invoiced and paid.' },
        { status: 400 }
      )
    }
    if (serviceRequest.invoiceId) {
      return NextResponse.json(
        { error: 'This request is already bundled on an invoice. Edit the invoice instead.' },
        { status: 400 }
      )
    }

    // Out-of-area pickup double-billing guard (Ryan, 2026-09-28). Scheduling
    // a removal now collects the order's out-of-area pickup half on its own —
    // charged to the card, or queued for the payer's next invoice as an
    // "Out-of-area pickup" line — so billing the same removal trip here by
    // hand would charge the pickup twice. Refuse unless the admin confirmed
    // this is a genuinely separate charge (the page sends allow_extra after
    // a confirm). A 'pending' half isn't collected yet and a 'failed' one
    // never was ("I'll send invoice worst case"), so neither is blocked.
    // No removal SR had ever been billed by hand when this landed.
    const pickupOrder = serviceRequest.type === 'removal' ? serviceRequest.installation?.order : null
    // A cancelled order's queued half is never bundled (and a cancelled order
    // owes no pickup fee), so it doesn't count as billed — unless it's already
    // on an invoice or was paid.
    const pickupVoided =
      pickupOrder?.status === 'cancelled' &&
      !pickupOrder.serviceAreaSecondChargeInvoiceId &&
      pickupOrder.serviceAreaSecondChargeStatus !== 'paid'
    if (
      pickupOrder &&
      !pickupVoided &&
      body.allow_extra !== true &&
      (pickupOrder.serviceAreaSecondChargeStatus === 'pending_invoice' ||
        pickupOrder.serviceAreaSecondChargeStatus === 'paid' ||
        !!pickupOrder.serviceAreaSecondChargeInvoiceId)
    ) {
      const pickupAmount = `$${((pickupOrder.serviceAreaSecondChargeCents ?? 0) / 100).toFixed(2)}`
      const invoiceNumber = pickupOrder.ooaPickupInvoice?.invoiceNumber
      const where =
        pickupOrder.serviceAreaSecondChargeStatus === 'paid'
          ? invoiceNumber
            ? `was already paid on invoice ${invoiceNumber}`
            : 'was already charged to their card'
          : invoiceNumber
            ? `is already on invoice ${invoiceNumber}`
            : 'is already added to their next invoice'
      return NextResponse.json(
        {
          error: `The out-of-area pickup (${pickupAmount}) for this order ${where}. Only add an amount here for a separate charge.`,
          code: 'ooa_pickup_already_billed',
        },
        { status: 409 }
      )
    }

    // Invoice-billing branch — defer instead of charging immediately. The SR
    // gets `invoiceStatus='pending_invoice'` and waits to be bundled onto an
    // Invoice via /admin/invoices, mirroring how invoice-billing orders flow.
    // No Stripe customer or saved card needed — collection happens later when
    // the customer pays the bundled invoice.
    if (serviceRequest.user.invoiceBilling) {
      // Conditional on the checks above still holding: a bundle that
      // attached this request since the read has already put the old amount
      // on a sent invoice (which re-reads the request live). The bundlers
      // attach only the amount they summed, so the reverse order refuses too.
      const written = await prisma.serviceRequest.updateMany({
        where: { id, invoiceId: null, invoiceStatus: { not: 'paid' } },
        data: {
          invoiceAmount: amount,
          invoiceStatus: 'pending_invoice',
        },
      })
      if (written.count !== 1) {
        return NextResponse.json(
          { error: 'This request was just added to an invoice. Refresh to see it.' },
          { status: 409 }
        )
      }
      const updated = await prisma.serviceRequest.findUnique({ where: { id } })
      try {
        await createNotification({
          userId: serviceRequest.userId,
          type: 'service_request_acknowledged',
          title: 'Service trip added to your next invoice',
          message: `A $${amount.toFixed(2)} service charge has been added to your next bundled invoice. No payment has been collected yet.`,
          link: '/dashboard/service-requests',
        })
      } catch (notifErr) {
        console.error('Invoice-billing SR notification failed:', notifErr)
      }
      return NextResponse.json({ serviceRequest: updated, deferred: true })
    }

    if (!serviceRequest.user.stripeCustomerId) {
      return NextResponse.json(
        { error: 'This customer has no payment profile on file, so their card cannot be charged.' },
        { status: 400 }
      )
    }

    // Prefer the customer's default card; fall back to any saved card.
    const paymentMethod =
      (await prisma.paymentMethod.findFirst({ where: { userId: serviceRequest.userId, isDefault: true } })) ||
      (await prisma.paymentMethod.findFirst({ where: { userId: serviceRequest.userId } }))

    if (!paymentMethod) {
      return NextResponse.json(
        { error: 'This customer has no saved card on file to charge. Ask them to add one.' },
        { status: 400 }
      )
    }

    const amountInCents = Math.round(amount * 100)

    try {
      const paymentIntent = await chargePaymentMethod(
        serviceRequest.user.stripeCustomerId,
        paymentMethod.stripePaymentMethodId,
        amountInCents,
        `Service trip invoice — ${serviceRequest.type}`,
        { serviceRequestId: serviceRequest.id, serviceType: serviceRequest.type }
      )

      if (paymentIntent.status !== 'succeeded') {
        // Off-session charge couldn't complete (e.g. card needs authentication).
        await prisma.serviceRequest.update({
          where: { id },
          data: { invoiceAmount: amount, invoiceStatus: 'failed' },
        })
        return NextResponse.json(
          { error: 'The card needs authentication and could not be charged automatically. Ask the customer to update their card or pay another way.' },
          { status: 400 }
        )
      }

      const updated = await prisma.serviceRequest.update({
        where: { id },
        data: {
          invoiceAmount: amount,
          invoiceStatus: 'paid',
          invoicePaidAt: new Date(),
          invoicePaymentIntentId: paymentIntent.id,
        },
      })

      // Let the customer know they were charged
      try {
        await createNotification({
          userId: serviceRequest.userId,
          type: 'service_request_acknowledged',
          title: 'Service charge processed',
          message: `A $${amount.toFixed(2)} charge for your service request was processed.`,
          link: '/dashboard/service-requests',
        })
      } catch (notifErr) {
        console.error('Invoice notification failed:', notifErr)
      }

      return NextResponse.json({ serviceRequest: updated })
    } catch (chargeError) {
      // Record the failed attempt so admin can see it, then surface a friendly message
      await prisma.serviceRequest
        .update({ where: { id }, data: { invoiceAmount: amount, invoiceStatus: 'failed' } })
        .catch(() => {})
      const friendly = getStripeErrorMessage(chargeError)
      console.error('Service request invoice charge failed:', chargeError)
      return NextResponse.json(
        { error: friendly || 'The charge could not be processed. Please try again.' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Error invoicing service request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
