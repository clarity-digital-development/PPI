/**
 * Client-side PDF generation for the order history report.
 *
 * Pink Posts brand colors live in [tailwind.config.ts] but are duplicated as
 * literals here because jspdf takes raw RGB triplets, not CSS variables.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { OrderData, OrderItemData } from '@/components/dashboard/order-history-table'

const PINK = { r: 232, g: 74, b: 122 } // #E84A7A — primary brand
const SOFT_PINK = { r: 255, g: 240, b: 243 } // #FFF0F3 — header band
const INK = { r: 51, g: 51, b: 51 } // #333 — body text
const MUTED = { r: 119, g: 119, b: 119 } // #777 — labels

interface BuildOptions {
  orders: OrderData[]
  startDate: string
  endDate: string
  minPrice?: number | null
  maxPrice?: number | null
  agentFilter?: string | null
  companyName?: string | null
}

function summarizeItems(items: OrderItemData[]): string {
  const parts: string[] = []
  const post = items.find(i => i.itemType === 'post')
  const sign = items.find(i => i.itemType === 'sign')
  const riders = items.filter(i => i.itemType === 'rider')
  const lockbox = items.find(i => i.itemType === 'lockbox')
  const brochure = items.find(i => i.itemType === 'brochure_box')
  if (post) parts.push('Post')
  if (sign) parts.push('Sign')
  if (riders.length) parts.push(`${riders.length} Rider${riders.length > 1 ? 's' : ''}`)
  if (lockbox) parts.push('Lockbox')
  if (brochure) parts.push('Brochure Box')
  return parts.join(', ') || `${items.length} item${items.length !== 1 ? 's' : ''}`
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

/**
 * Builds and triggers a download of an Order History PDF. Returns the filename
 * used so the caller can show it to the user.
 */
export function exportOrderHistoryPdf(opts: BuildOptions): string {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
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
  doc.text('Order History Report', margin, 58)
  if (opts.companyName) {
    doc.setFontSize(10)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.text(opts.companyName, margin, 74)
  }

  // --- Filter / metadata block ---
  const metaTop = 110
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('DATE RANGE', margin, metaTop)
  doc.setTextColor(INK.r, INK.g, INK.b)
  doc.setFontSize(11)
  doc.text(`${opts.startDate}  to  ${opts.endDate}`, margin, metaTop + 14)

  const filterBits: string[] = []
  if (opts.minPrice != null) filterBits.push(`Min ${fmtCurrency(opts.minPrice)}`)
  if (opts.maxPrice != null) filterBits.push(`Max ${fmtCurrency(opts.maxPrice)}`)
  if (opts.agentFilter) filterBits.push(`Agent: ${opts.agentFilter}`)
  if (filterBits.length) {
    doc.setFontSize(9)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.text('FILTERS', margin + 220, metaTop)
    doc.setTextColor(INK.r, INK.g, INK.b)
    doc.setFontSize(11)
    doc.text(filterBits.join('   |   '), margin + 220, metaTop + 14)
  }

  // --- Totals block (right side) ---
  const totalRevenue = opts.orders.reduce((acc, o) => acc + Number(o.total || 0), 0)
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('TOTAL', pageWidth - margin, metaTop, { align: 'right' })
  doc.setFontSize(16)
  doc.setTextColor(PINK.r, PINK.g, PINK.b)
  doc.setFont('helvetica', 'bold')
  doc.text(fmtCurrency(totalRevenue), pageWidth - margin, metaTop + 18, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text(`${opts.orders.length} order${opts.orders.length === 1 ? '' : 's'}`, pageWidth - margin, metaTop + 32, { align: 'right' })

  // --- Table ---
  const rows = opts.orders.map((o) => [
    o.orderNumber,
    fmtDate(o.createdAt),
    `${o.propertyAddress}\n${o.propertyCity}, ${o.propertyState} ${o.propertyZip}`,
    summarizeItems(o.orderItems),
    o.placedForAgentName || '—',
    fmtCurrency(Number(o.total || 0)),
  ])

  autoTable(doc, {
    startY: metaTop + 55,
    head: [['Order #', 'Date', 'Address', 'Installed', 'Agent', 'Price']],
    body: rows,
    margin: { left: margin, right: margin },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 6,
      textColor: [INK.r, INK.g, INK.b],
      lineColor: [230, 230, 230],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [PINK.r, PINK.g, PINK.b],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [SOFT_PINK.r, SOFT_PINK.g, SOFT_PINK.b],
    },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 60 },
      2: { cellWidth: 160 },
      3: { cellWidth: 100 },
      4: { cellWidth: 70 },
      5: { cellWidth: 65, halign: 'right' },
    },
    didDrawPage: (data) => {
      // Footer: generated-at stamp on every page.
      const stamp = `Generated ${new Date().toLocaleString('en-US')}`
      doc.setFontSize(8)
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
      doc.text(stamp, margin, doc.internal.pageSize.getHeight() - 20)
      doc.text(
        `Page ${data.pageNumber}`,
        pageWidth - margin,
        doc.internal.pageSize.getHeight() - 20,
        { align: 'right' },
      )
    },
  })

  const filename = `order-history-${opts.startDate}-to-${opts.endDate}.pdf`
  doc.save(filename)
  return filename
}
