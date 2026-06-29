import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildInvoicePdfBytes, type InvoiceDetail } from '@/lib/invoices/invoice-pdf'

/**
 * PUBLIC invoice PDF — no auth, token-gated.
 *
 * Customers click a link in their bundled-invoice email and land directly on
 * the rendered PDF in their browser. The link includes a per-invoice opaque
 * `publicPdfToken` so anyone with the URL (and only them) can view; the URL
 * is otherwise unguessable.
 *
 *   GET /api/invoices/[id]/pdf?token=<publicPdfToken>
 *
 * Returns `application/pdf` with `Content-Disposition: inline` so the
 * browser renders the PDF instead of forcing a download.
 *
 * No-store cache headers since the invoice may transition sent → paid.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 })
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, name: true, email: true, company: true } },
      orders: { include: { orderItems: true }, orderBy: { createdAt: 'asc' } },
      serviceRequests: {
        include: { installation: { select: { propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true } } },
        orderBy: { completedAt: 'asc' },
      },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!invoice.publicPdfToken || invoice.publicPdfToken !== token) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const detail: InvoiceDetail = {
    id: invoice.id,
    invoice_number: invoice.invoiceNumber,
    status: invoice.status as 'sent' | 'paid' | 'void',
    range_start: invoice.rangeStart.toISOString(),
    range_end: invoice.rangeEnd.toISOString(),
    subtotal: Number(invoice.subtotal),
    // Subtotal split — orders are the taxable base, service trips are flat-
    // billed with no tax. Sum to `subtotal`. See lib/invoices/load-detail.ts
    // for the rationale and the canonical computation.
    orders_subtotal: invoice.orders.reduce((s, o) => s + Number(o.subtotal ?? 0), 0),
    service_requests_subtotal: invoice.serviceRequests.reduce((s, sr) => s + Number(sr.invoiceAmount ?? 0), 0),
    total: Number(invoice.total),
    fuel_total: invoice.orders.reduce((s, o) => s + Number(o.fuelSurcharge ?? 0), 0),
    tax_total: invoice.orders.reduce((s, o) => s + Number(o.tax ?? 0), 0),
    expedite_total: invoice.orders.reduce((s, o) => s + Number(o.expediteFee ?? 0), 0),
    no_post_total: invoice.orders.reduce((s, o) => s + Number(o.noPostSurcharge ?? 0), 0),
    discount_total: invoice.orders.reduce((s, o) => s + Number(o.discount ?? 0), 0),
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
      subtotal: Number(o.subtotal),
      total: Number(o.total),
      flat_fee_applied: o.flatFeeApplied,
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

  const pdfBytes = buildInvoicePdfBytes(detail)
  // Buffer wraps the bytes for Next's Response body; matches what Resend does
  // for the attachment branch so the same bytes are served either way.
  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoice.invoiceNumber}.pdf"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
