/**
 * Customer-facing invoice PDF.
 *
 * Used both client-side (download button on /dashboard/invoices/[id]) and
 * server-side (Resend email attachment). The shape of `InvoiceDetail` matches
 * the response of /api/invoices/[id] exactly so the same object can flow
 * straight from the API into either renderer.
 *
 * Brand palette is duplicated as raw RGB triplets because jspdf doesn't read
 * CSS variables — same approach as [lib/orders/order-history-pdf.ts].
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const PINK = { r: 232, g: 74, b: 122 } // #E84A7A — primary brand
const SOFT_PINK = { r: 255, g: 240, b: 243 } // #FFF0F3 — header band + zebra
const INK = { r: 51, g: 51, b: 51 } // #333 — body text
const MUTED = { r: 119, g: 119, b: 119 } // #777 — labels

export interface InvoiceItem {
  description: string
  quantity: number
  unit_price: number
  total_price: number
}

export interface InvoiceOrder {
  id: string
  order_number: string
  created_at: string
  property_address: string
  property_city: string
  property_state: string
  property_zip: string
  subtotal: number
  total: number
  // CR4: flat-fee orders bill a single line ($60 base; fuel + tax show in the
  // invoice Total) instead of the real à-la-carte items.
  flat_fee_applied: boolean
  placed_for_agent_name: string | null
  items: InvoiceItem[]
}

export interface InvoiceServiceRequest {
  id: string
  type: string
  description: string | null
  completed_at: string | null
  created_at: string
  property_address: string | null
  property_city: string | null
  property_state: string | null
  property_zip: string | null
  amount: number
}

export interface InvoiceDetail {
  id: string
  invoice_number: string
  status: 'sent' | 'paid' | 'void'
  range_start: string
  range_end: string
  subtotal: number
  total: number
  // Aggregated across the bundled orders so the totals box can explain the
  // gap between Subtotal and Total (fuel + tax + fees), instead of an
  // unexplained jump. Service-request amounts sit inside subtotal already.
  fuel_total: number
  tax_total: number
  expedite_total: number
  no_post_total: number
  discount_total: number
  sent_at: string | null
  paid_at: string | null
  customer: {
    id: string
    name: string
    email: string
    company: string | null
  }
  orders: InvoiceOrder[]
  service_requests: InvoiceServiceRequest[]
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

function formatAddress(addr: string | null, city: string | null, state: string | null, zip: string | null): string {
  const parts = [addr, [city, state].filter(Boolean).join(', '), zip].filter(Boolean)
  return parts.join(' ').trim() || '—'
}

function srTypeLabel(t: string): string {
  switch (t) {
    case 'service': return 'Service trip'
    case 'removal': return 'Removal'
    case 'repair': return 'Repair'
    case 'replacement': return 'Replacement'
    default: return t
  }
}

/**
 * Build the jsPDF document in memory. Caller decides whether to .save() it
 * (browser download) or .output('arraybuffer') it (Resend attachment).
 */
export function buildInvoicePdfDoc(invoice: InvoiceDetail): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 40

  // --- Header band ---
  doc.setFillColor(SOFT_PINK.r, SOFT_PINK.g, SOFT_PINK.b)
  doc.rect(0, 0, pageWidth, 90, 'F')
  doc.setTextColor(PINK.r, PINK.g, PINK.b)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Pink Posts Installations', margin, 38)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(INK.r, INK.g, INK.b)
  doc.text('Invoice', margin, 58)
  doc.setFontSize(10)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text(invoice.invoice_number, margin, 74)

  // --- Right-side totals ---
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('TOTAL DUE', pageWidth - margin, 38, { align: 'right' })
  doc.setFontSize(22)
  doc.setTextColor(PINK.r, PINK.g, PINK.b)
  doc.setFont('helvetica', 'bold')
  doc.text(fmtCurrency(invoice.total), pageWidth - margin, 60, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  const orderCount = invoice.orders.length
  const srCount = invoice.service_requests.length
  const countLine = [
    orderCount ? `${orderCount} order${orderCount === 1 ? '' : 's'}` : null,
    srCount ? `${srCount} service trip${srCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' + ')
  if (countLine) {
    doc.text(countLine, pageWidth - margin, 76, { align: 'right' })
  }

  // --- Bill-to / period / status block ---
  const metaTop = 115
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('BILLED TO', margin, metaTop)
  doc.setTextColor(INK.r, INK.g, INK.b)
  doc.setFontSize(11)
  doc.text(invoice.customer.name, margin, metaTop + 14)
  let billRowY = metaTop + 28
  if (invoice.customer.company) {
    doc.setFontSize(10)
    doc.text(invoice.customer.company, margin, billRowY)
    billRowY += 14
  }
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text(invoice.customer.email, margin, billRowY)

  // Period column
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('BILLING PERIOD', margin + 220, metaTop)
  doc.setFontSize(11)
  doc.setTextColor(INK.r, INK.g, INK.b)
  // ASCII-only — jspdf's standard helvetica is Latin-1 and renders the
  // Unicode arrow as "!", so " to " is the safest reliable separator.
  doc.text(`${invoice.range_start.slice(0, 10)}  to  ${invoice.range_end.slice(0, 10)}`, margin + 220, metaTop + 14)
  if (invoice.sent_at) {
    doc.setFontSize(9)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.text(`Issued ${fmtDate(invoice.sent_at)}`, margin + 220, metaTop + 28)
  }

  // Status pill (right side)
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('STATUS', pageWidth - margin, metaTop, { align: 'right' })
  const statusLabel = invoice.status === 'paid' ? 'PAID' : invoice.status === 'void' ? 'VOIDED' : 'OUTSTANDING'
  const statusColor =
    invoice.status === 'paid' ? { r: 34, g: 197, b: 94 } :
    invoice.status === 'void' ? MUTED :
    PINK
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(statusColor.r, statusColor.g, statusColor.b)
  doc.text(statusLabel, pageWidth - margin, metaTop + 14, { align: 'right' })
  if (invoice.paid_at) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.text(`Paid ${fmtDate(invoice.paid_at)}`, pageWidth - margin, metaTop + 28, { align: 'right' })
  }

  // --- PAID watermark (diagonal across the body when paid) ---
  if (invoice.status === 'paid') {
    doc.saveGraphicsState()
    // 8% gray-ish via low-alpha green pink mix; jspdf has setGState
    // @ts-ignore - jspdf types lag on GState
    doc.setGState(new (doc as any).GState({ opacity: 0.08 }))
    doc.setTextColor(34, 197, 94)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(120)
    doc.text('PAID', pageWidth / 2, pageHeight / 2 + 30, { align: 'center', angle: 25 })
    doc.restoreGraphicsState()
    doc.setFont('helvetica', 'normal')
  }

  // --- Build the table rows ---
  // One row per line item — order rows repeat the order # / date / address /
  // agent on each item row (autoTable doesn't merge cells; the visual
  // repetition is fine and makes per-item unit prices first-class). SRs are
  // a single line each.
  type Row = [string, string, string, string, string, string, string, string]
  const rows: Row[] = []

  for (const o of invoice.orders) {
    const addr = formatAddress(o.property_address, o.property_city, o.property_state, o.property_zip)
    const agent = o.placed_for_agent_name || '—'
    if (o.flat_fee_applied) {
      // CR4: one flat line at the order subtotal ($60); the $2.47 fuel + 6% tax
      // are reflected in the invoice Total below, so line items reconcile to the
      // invoice Subtotal.
      rows.push([o.order_number, fmtDate(o.created_at), addr, agent, 'Flat Installation Fee', '1', fmtCurrency(o.subtotal), fmtCurrency(o.subtotal)])
    } else if (o.items.length === 0) {
      rows.push([o.order_number, fmtDate(o.created_at), addr, agent, '(order)', '', '', fmtCurrency(o.total)])
    } else {
      o.items.forEach((it, idx) => {
        rows.push([
          idx === 0 ? o.order_number : '',
          idx === 0 ? fmtDate(o.created_at) : '',
          idx === 0 ? addr : '',
          idx === 0 ? agent : '',
          it.description,
          String(it.quantity),
          fmtCurrency(it.unit_price),
          fmtCurrency(it.total_price),
        ])
      })
    }
  }

  for (const sr of invoice.service_requests) {
    const addr = formatAddress(sr.property_address, sr.property_city, sr.property_state, sr.property_zip)
    const itemLabel = sr.description ? `${srTypeLabel(sr.type)}: ${sr.description}` : srTypeLabel(sr.type)
    rows.push([
      `SR ${sr.id.slice(-6).toUpperCase()}`,
      fmtDate(sr.completed_at || sr.created_at),
      addr,
      '—',
      itemLabel,
      '1',
      fmtCurrency(sr.amount),
      fmtCurrency(sr.amount),
    ])
  }

  autoTable(doc, {
    startY: metaTop + 70,
    head: [['Order / SR #', 'Date', 'Address', 'Agent', 'Item', 'Qty', 'Unit', 'Total']],
    body: rows,
    margin: { left: margin, right: margin },
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 5,
      textColor: [INK.r, INK.g, INK.b],
      lineColor: [230, 230, 230],
      lineWidth: 0.5,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [PINK.r, PINK.g, PINK.b],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left',
      fontSize: 9,
    },
    alternateRowStyles: {
      fillColor: [SOFT_PINK.r, SOFT_PINK.g, SOFT_PINK.b],
    },
    // Column widths sum to 532pt = letter (612pt) - 2 * 40pt margin. Keep
    // the sum at or below 532 so autoTable doesn't truncate.
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 50 },
      2: { cellWidth: 135 },
      3: { cellWidth: 55 },
      4: { cellWidth: 100 },
      5: { cellWidth: 28, halign: 'center' },
      6: { cellWidth: 50, halign: 'right' },
      7: { cellWidth: 54, halign: 'right' },
    },
    didDrawPage: (data) => {
      // Footer: generated-at stamp + page number.
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
      doc.text('Questions? contact@pinkposts.com', pageWidth / 2, pageHeight - 20, { align: 'center' })
      doc.text(
        `Page ${data.pageNumber}`,
        pageWidth - margin,
        pageHeight - 20,
        { align: 'right' },
      )
    },
  })

  // --- Totals box after the table ---
  // jspdf-autotable hangs the final Y position off the doc as lastAutoTable.
  const finalY = (doc as any).lastAutoTable?.finalY ?? metaTop + 70
  let tY = finalY + 24
  // Reserve room for the subtotal + breakdown rows + total so the box never
  // splits awkwardly across the page break.
  if (tY > pageHeight - 200) {
    doc.addPage()
    tY = 80
  }

  // Subtotal + breakdown rows. Listing fuel/tax/fees here explains the gap
  // between Subtotal and Total (previously the jump had no line items).
  const labelX = pageWidth - margin - 90
  const amtX = pageWidth - margin
  let rowY = tY
  const detailRow = (label: string, value: number, negative = false) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.text(label, labelX, rowY, { align: 'right' })
    doc.setTextColor(INK.r, INK.g, INK.b)
    doc.text((negative ? '-' : '') + fmtCurrency(value), amtX, rowY, { align: 'right' })
    rowY += 16
  }

  detailRow('Subtotal', invoice.subtotal)
  if (invoice.discount_total > 0) detailRow('Discount', invoice.discount_total, true)
  if (invoice.no_post_total > 0) detailRow('Service Trip Fee (no post)', invoice.no_post_total)
  if (invoice.expedite_total > 0) detailRow('Expedite Fee', invoice.expedite_total)
  if (invoice.fuel_total > 0) detailRow('Fuel Surcharge', invoice.fuel_total)
  if (invoice.tax_total > 0) detailRow('Sales Tax', invoice.tax_total)

  // Divider, then the bold Total.
  const lineY = rowY - 4
  doc.setDrawColor(220, 220, 220)
  doc.line(pageWidth - margin - 160, lineY, pageWidth - margin, lineY)
  const totalY = lineY + 22
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('Total', labelX, totalY, { align: 'right' })
  doc.setTextColor(PINK.r, PINK.g, PINK.b)
  doc.text(fmtCurrency(invoice.total), amtX, totalY, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  tY = totalY

  // Pay-online link (only if outstanding)
  if (invoice.status === 'sent') {
    tY += 36
    doc.setFontSize(10)
    doc.setTextColor(PINK.r, PINK.g, PINK.b)
    doc.text(
      `Pay this invoice online at pinkposts.com/dashboard/invoices/${invoice.id}`,
      pageWidth / 2,
      tY,
      { align: 'center' },
    )
  }

  return doc
}

/**
 * Browser-side: trigger a download and return the filename used.
 */
export function exportInvoicePdf(invoice: InvoiceDetail): string {
  const doc = buildInvoicePdfDoc(invoice)
  const filename = `invoice-${invoice.invoice_number}.pdf`
  doc.save(filename)
  return filename
}

/**
 * Server-side: return the raw bytes so the caller can attach to email.
 * jspdf works in Node — no DOM needed for headless ops.
 */
export function buildInvoicePdfBytes(invoice: InvoiceDetail): Uint8Array {
  const doc = buildInvoicePdfDoc(invoice)
  return new Uint8Array(doc.output('arraybuffer'))
}
