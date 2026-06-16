import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { createInvoiceCheckoutSession, stripe } from '@/lib/stripe/server'
import { sendInvoiceEmail } from '@/lib/email'
import { buildInvoicePdfBytes, type InvoiceDetail } from '@/lib/invoices/invoice-pdf'

/**
 * Admin: regenerate the Stripe Payment Link for an invoice.
 *
 * Use case: the original Payment Link is broken/deactivated/can't be paid
 * (rare — Payment Links don't expire, but a Stripe outage or accidental
 * deactivation could leave a customer stranded). Admin clicks "Regenerate
 * Payment Link" on /admin/invoices and we:
 *
 *   1. Deactivate the old Payment Link in Stripe (best-effort).
 *   2. Create a fresh Payment Link with a NEW idempotency key — the old key
 *      points at the deactivated link, so we suffix with a regen counter to
 *      get a fresh one.
 *   3. Update Invoice.checkoutSessionId + checkoutUrl.
 *   4. Re-render the PDF and re-send the invoice email to the same recipient
 *      (billing contact if set, else account email) so the customer gets the
 *      working link without the admin having to copy/paste anything.
 *
 * Refuses to regenerate for already-paid or voided invoices.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, fullName: true, name: true, company: true, billingEmail: true } },
      orders: { include: { orderItems: true }, orderBy: { createdAt: 'asc' } },
      serviceRequests: {
        include: { installation: { select: { propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true } } },
        orderBy: { completedAt: 'asc' },
      },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status === 'paid') {
    return NextResponse.json({ error: 'Invoice is already paid — no Payment Link needed.' }, { status: 400 })
  }
  if (invoice.status === 'void') {
    return NextResponse.json({ error: 'Invoice is voided — regenerate not allowed.' }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://pinkposts.com'
  const recipientEmail = invoice.user.billingEmail || invoice.user.email

  // Best-effort deactivate the old Payment Link so a stale URL can't accept
  // payment after we've issued a new one. Failure is non-fatal — admin may
  // have already deactivated it manually in Stripe.
  const oldLinkId = invoice.checkoutSessionId
  if (oldLinkId && oldLinkId.startsWith('plink_')) {
    try {
      await stripe().paymentLinks.update(oldLinkId, { active: false })
    } catch (err) {
      console.warn(`Regenerate: could not deactivate old Payment Link ${oldLinkId}:`, err)
    }
  }

  // Create the new Payment Link. Bump the idempotency key with a regen
  // counter so Stripe gives us a fresh link instead of returning the old
  // (now-deactivated) one. Counter = number of times we've already
  // regenerated, derived from the audit log or simply the current time.
  // Simpler approach: use the current Invoice.updatedAt millis as the bump.
  // Counter pulled from update_at timestamp + invocation time to guarantee
  // uniqueness across rapid retries.
  const bump = `${invoice.updatedAt.getTime()}-${Date.now()}`
  let newLink: { id: string; url: string | null }
  try {
    newLink = await createInvoiceCheckoutSession({
      invoiceId: `${invoice.id}#${bump}`, // affects idempotency key only
      invoiceNumber: invoice.invoiceNumber,
      amountInCents: Math.round(Number(invoice.total) * 100),
      customerEmail: recipientEmail,
      successUrl: `${baseUrl}/invoice-paid?invoice=${invoice.invoiceNumber}`,
      cancelUrl: `${baseUrl}/invoice-cancelled?invoice=${invoice.invoiceNumber}`,
      description: `${invoice.orders.length} order(s) + ${invoice.serviceRequests.length} service trip(s)`,
    })
  } catch (err) {
    console.error('Regenerate: Stripe Payment Link create failed:', err)
    return NextResponse.json(
      { error: 'Could not create a new Stripe Payment Link. Please try again.' },
      { status: 500 },
    )
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { checkoutSessionId: newLink.id, checkoutUrl: newLink.url },
  })

  // Re-render the PDF and resend the email with the fresh Pay link. We
  // intentionally bypass the invoiceEmailSentAt reservation flag so the
  // resend always goes out (the regenerate button is an explicit
  // human-initiated retry — flag is for accidental double-bundling, not
  // intentional manual resend).
  const detail: InvoiceDetail = {
    id: invoice.id,
    invoice_number: invoice.invoiceNumber,
    status: invoice.status as 'sent' | 'paid' | 'void',
    range_start: invoice.rangeStart.toISOString(),
    range_end: invoice.rangeEnd.toISOString(),
    subtotal: Number(invoice.subtotal),
    total: Number(invoice.total),
    sent_at: invoice.sentAt?.toISOString() ?? null,
    paid_at: invoice.paidAt?.toISOString() ?? null,
    customer: {
      id: invoice.user.id,
      name: invoice.user.fullName || invoice.user.name || invoice.user.email,
      email: invoice.user.email,
      company: invoice.user.company,
    },
    orders: invoice.orders.map((o) => ({
      id: o.id,
      order_number: o.orderNumber,
      created_at: o.createdAt.toISOString(),
      property_address: o.propertyAddress,
      property_city: o.propertyCity,
      property_state: o.propertyState,
      property_zip: o.propertyZip,
      total: Number(o.total),
      placed_for_agent_name: o.placedForAgentName,
      items: o.orderItems.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unit_price: Number(it.unitPrice),
        total_price: Number(it.totalPrice),
      })),
    })),
    service_requests: invoice.serviceRequests.map((sr) => ({
      id: sr.id,
      type: sr.type,
      description: sr.description,
      completed_at: sr.completedAt?.toISOString() ?? null,
      created_at: sr.createdAt.toISOString(),
      property_address: sr.installation?.propertyAddress ?? sr.unlistedAddress ?? null,
      property_city: sr.installation?.propertyCity ?? sr.unlistedCity ?? null,
      property_state: sr.installation?.propertyState ?? sr.unlistedState ?? null,
      property_zip: sr.installation?.propertyZip ?? sr.unlistedZip ?? null,
      amount: Number(sr.invoiceAmount || 0),
    })),
  }

  let emailSent = false
  try {
    const pdfBytes = buildInvoicePdfBytes(detail)
    await sendInvoiceEmail({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: detail.customer.name,
      customerEmail: recipientEmail,
      companyName: detail.customer.company,
      rangeStart: detail.range_start.slice(0, 10),
      rangeEnd: detail.range_end.slice(0, 10),
      total: detail.total,
      orderCount: invoice.orders.length,
      serviceRequestCount: invoice.serviceRequests.length,
      pdfBytes,
      pdfUrl: invoice.publicPdfToken
        ? `${baseUrl}/api/invoices/${invoice.id}/pdf?token=${invoice.publicPdfToken}`
        : null,
      payUrl: newLink.url,
      subjectOverride: `Updated payment link — Invoice ${invoice.invoiceNumber} — $${detail.total.toFixed(2)}`,
      bannerHtml: `
        <div style="background-color: #FEF3C7; border: 1px solid #F59E0B; color: #92400E; padding: 14px 16px; border-radius: 8px; margin-bottom: 24px; text-align: left; font-size: 14px;">
          <strong>Updated payment link.</strong> The previous link for this invoice has been replaced — please use the new "Pay" button below.
        </div>
      `,
      recipientUserId: invoice.userId,
    })
    emailSent = true
  } catch (err) {
    console.error('Regenerate: re-send email failed (link was created successfully):', err)
  }

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.InvoiceCreated, // no dedicated enum value yet — reuse with metadata
    targetType: 'invoice',
    targetId: invoice.id,
    metadata: {
      action: 'regenerate_payment_link',
      oldLinkId: oldLinkId ?? null,
      newLinkId: newLink.id,
      newLinkUrl: newLink.url,
      sentToEmail: recipientEmail,
      emailResent: emailSent,
    },
    request,
  })

  return NextResponse.json({
    ok: true,
    checkout_session_id: newLink.id,
    checkout_url: newLink.url,
    email_resent: emailSent,
    sent_to_email: recipientEmail,
  })
}
