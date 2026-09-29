import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-utils'
import { loadInvoiceDetailForPdf } from '@/lib/invoices/load-detail'

/**
 * Customer-facing invoice detail. Returns enough to render the pay page and
 * generate a PDF: invoice metadata + every order, service trip AND
 * out-of-area pickup billed on the invoice + property summaries + per-item
 * unit/total prices.
 *
 * The body is loadInvoiceDetailForPdf — the same loader the emailed PDF and
 * the public PDF route use. This route used to carry a hand-written copy of
 * that mapping, typed as nothing, so when a field was added to InvoiceDetail
 * (the out-of-area pickups, Ryan 2026-09-28) the compiler couldn't flag that
 * this copy never sent it and the pay page's totals stopped adding up.
 *
 * Authz: invoice owner OR admin. Team admins can NOT view another team
 * admin's invoice — the field belongs to a single billable account.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const invoice = await loadInvoiceDetailForPdf(id)

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // customer.id is the invoice's userId (the loader maps it from invoice.user).
  if (invoice.customer.id !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ invoice })
}
