import { prisma } from '@/lib/prisma'
import type { InvoiceDetail } from './invoice-pdf'

/**
 * Load an invoice in the exact shape the PDF builder + customer page expect.
 * Used by both /api/admin/invoices (POST + regenerate) and /api/invoices/bundle
 * (broker self-serve) so the resulting PDFs are byte-identical regardless of
 * which path created the invoice.
 */
export async function loadInvoiceDetailForPdf(invoiceId: string): Promise<InvoiceDetail | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      user: { select: { id: true, fullName: true, name: true, email: true, company: true } },
      orders: { include: { orderItems: true }, orderBy: { createdAt: 'asc' } },
      serviceRequests: {
        include: { installation: { select: { propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true } } },
        orderBy: { completedAt: 'asc' },
      },
    },
  })
  if (!invoice) return null
  const orderSum = (key: 'fuelSurcharge' | 'tax' | 'expediteFee' | 'noPostSurcharge' | 'discount') =>
    invoice.orders.reduce((s, o) => s + Number((o as Record<string, unknown>)[key] ?? 0), 0)
  // Subtotal split — orders are the taxable base (per-order tax was computed at
  // order time and lives in tax_total); service trips bill at a flat amount
  // with no tax field (KY: standalone service labor sans post rental = not
  // taxable per Ryan 2026-06-28). Splitting them on the invoice lets the
  // customer see why total tax isn't 6% of the grand subtotal.
  const orders_subtotal = invoice.orders.reduce((s, o) => s + Number(o.subtotal ?? 0), 0)
  const service_requests_subtotal = invoice.serviceRequests.reduce((s, sr) => s + Number(sr.invoiceAmount ?? 0), 0)
  return {
    id: invoice.id,
    invoice_number: invoice.invoiceNumber,
    status: invoice.status as 'sent' | 'paid' | 'void',
    range_start: invoice.rangeStart.toISOString(),
    range_end: invoice.rangeEnd.toISOString(),
    subtotal: Number(invoice.subtotal),
    orders_subtotal,
    service_requests_subtotal,
    total: Number(invoice.total),
    fuel_total: orderSum('fuelSurcharge'),
    tax_total: orderSum('tax'),
    expedite_total: orderSum('expediteFee'),
    no_post_total: orderSum('noPostSurcharge'),
    discount_total: orderSum('discount'),
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
}
