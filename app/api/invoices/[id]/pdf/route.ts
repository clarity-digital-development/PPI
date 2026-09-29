import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildInvoicePdfBytes } from '@/lib/invoices/invoice-pdf'
import { loadInvoiceDetailForPdf } from '@/lib/invoices/load-detail'

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

  // Token check first, off a narrow read — nothing about the invoice is
  // loaded until the caller has proven they hold the link.
  const gate = await prisma.invoice.findUnique({
    where: { id },
    select: { publicPdfToken: true },
  })
  if (!gate) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!gate.publicPdfToken || gate.publicPdfToken !== token) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Same loader as the emailed attachment and the pay page (this route used
  // to hand-copy its mapping), so the public PDF can't drift from them — it
  // picks up the out-of-area pickup lines (Ryan, 2026-09-28) with no copy
  // to keep in step.
  const detail = await loadInvoiceDetailForPdf(id)
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const pdfBytes = buildInvoicePdfBytes(detail)
  // Buffer wraps the bytes for Next's Response body; matches what Resend does
  // for the attachment branch so the same bytes are served either way.
  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${detail.invoice_number}.pdf"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
