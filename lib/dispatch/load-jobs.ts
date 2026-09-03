/**
 * The ONLY place the installer dispatch feature touches Prisma. Every select
 * below is an allowlist of installer-relevant fields; money columns are never
 * fetched. See lib/dispatch/types.ts for the full rationale.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveAssignedAgent } from '@/lib/orders/assigned-agent'
import {
  INSTALLABLE_ITEM_TYPES,
  redactAllStrings,
  type DispatchJob,
  type DispatchOrderJob,
  type DispatchPhoto,
  type DispatchServiceJob,
  type DispatchSkipped,
} from './types'

export const MAX_DISPATCH_JOBS = 50

// Photo attachment budget (Ryan, 2026-08-25: attach the install-location
// photo). Single image cap keeps one oversized upload from dominating the
// email; the running total stays well under Resend's 40 MB message cap.
const MAX_PHOTO_BYTES = 3 * 1024 * 1024
const MAX_TOTAL_PHOTO_BYTES = 15 * 1024 * 1024

export const DISPATCH_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  isExpedited: true,
  scheduledDate: true,
  propertyAddress: true,
  propertyCity: true,
  propertyState: true,
  propertyZip: true,
  propertyType: true,
  propertyNotes: true,
  isGatedCommunity: true,
  gateCode: true,
  hasMarkerPlaced: true,
  streetNumbersVisible: true,
  signOrientation: true,
  signOrientationOther: true,
  installationLocation: true,
  placedForAgentName: true,
  postType: { select: { name: true } },
  user: { select: { fullName: true, name: true, email: true, phone: true, company: true, teamId: true } },
  orderItems: {
    where: { itemType: { in: [...INSTALLABLE_ITEM_TYPES] } },
    select: { description: true, quantity: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderSelect
// Deliberately NOT selected: subtotal, fuelSurcharge, noPostSurcharge,
// serviceAreaSurchargeCents, serviceAreaSecondCharge*, expediteFee, discount,
// tax, total, promoCodeId, paymentStatus, paymentIntentId, refunded*,
// pendingCreditCents, postInvoice*, editCharge*, invoiceId, OrderItem
// unitPrice/totalPrice, PostType.price. installationLocationImage is fetched
// per job below (up to 5 MB base64 each — never in the list query).

export const DISPATCH_SR_SELECT = {
  id: true,
  type: true,
  status: true,
  description: true,
  notes: true,
  requestedDate: true,
  unlistedAddress: true,
  unlistedCity: true,
  unlistedState: true,
  unlistedZip: true,
  user: { select: { fullName: true, name: true, email: true, phone: true, company: true, teamId: true } },
  installation: {
    select: {
      propertyAddress: true,
      propertyCity: true,
      propertyState: true,
      propertyZip: true,
      order: {
        select: {
          orderNumber: true,
          // Broker accounts: the agent the original order was placed for
          // (Ryan 2026-09-01 — removal dispatches showed only the broker).
          placedForAgentName: true,
          orderItems: {
            where: { itemType: { in: [...INSTALLABLE_ITEM_TYPES] } },
            select: { description: true, quantity: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
      riders: { where: { removedAt: null }, select: { rider: { select: { name: true } } } },
      lockboxes: {
        where: { removedAt: null },
        select: {
          code: true,
          lockboxType: { select: { name: true } },
          customerLockbox: { select: { code: true, serialNumber: true } },
        },
      },
    },
  },
} satisfies Prisma.ServiceRequestSelect
// Deliberately NOT selected: invoiceAmount, invoiceStatus,
// invoicePaymentIntentId, invoicePaidAt, invoiceId, adminNotes (internal).

function mapsUrl(a: { line1: string; city: string; state: string; zip: string }): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.line1}, ${a.city}, ${a.state} ${a.zip}`)}`
}

function dayString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function orientationLabel(orientation: string | null, other: string | null): string | null {
  if (!orientation) return null
  if (orientation === 'other' && other) return other
  return orientation.replace(/_/g, ' ')
}

function labelRequestType(type: string): string {
  switch (type) {
    case 'service': return 'Service Trip'
    case 'removal': return 'Removal'
    case 'repair': return 'Repair'
    case 'replacement': return 'Replacement'
    default: return type.charAt(0).toUpperCase() + type.slice(1)
  }
}

// SR descriptions carry app-composed suffixes the crew must not see:
//  - unlisted-address SRs get "[Unlisted Address: …]" appended by
//    app/api/service-requests/route.ts (the address is already the job header)
//  - the dashboard trip modal bakes "… Address: X. Trip fee: $40" into EVERY
//    service-trip description (ScheduleTripModal.tsx). Even redacted, a
//    "Trip fee: [amount removed]" line tells the installer a charge exists —
//    exactly the conversation this email is meant to avoid.
// Exported for the regression script.
export function cleanServiceDescription(description: string | null, unlisted: boolean): string | null {
  if (!description) return null
  let d = unlisted ? description.replace(/\s*\n?\n?\[Unlisted Address:[^\]]*\]\s*$/i, '') : description
  d = d.replace(/\.?\s*Trip fee:\s*\$?\s*[\d.,]+\s*$/i, '')
  d = d.replace(/\.?\s*Address:\s*[^\n]*$/i, '')
  return d.trim() || null
}

function decodeDataUri(uri: string): DispatchPhoto | null {
  // Any raster the upload input accepted (image/*) — Resend infers the
  // content type from the filename extension.
  const m = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(uri.trim())
  if (!m) return null
  const sub = m[1].toLowerCase()
  const ext = sub === 'jpeg' ? 'jpg' : sub === 'svg+xml' ? 'svg' : sub.replace(/[^a-z0-9]/g, '')
  try {
    return { filename: `location.${ext}`, content: Buffer.from(m[2], 'base64') }
  } catch {
    return null
  }
}

export async function loadDispatchJobs(input: {
  orderIds: string[]
  serviceRequestIds: string[]
}): Promise<{ jobs: DispatchJob[]; skipped: DispatchSkipped[] }> {
  const skipped: DispatchSkipped[] = []
  const jobs: DispatchJob[] = []

  // ---- Orders ----
  const orders = input.orderIds.length
    ? await prisma.order.findMany({ where: { id: { in: input.orderIds } }, select: DISPATCH_ORDER_SELECT })
    : []
  const orderById = new Map(orders.map((o) => [o.id, o]))
  for (const id of input.orderIds) {
    const o = orderById.get(id)
    if (!o) { skipped.push({ kind: 'order', id, label: id, reason: 'not_found' }); continue }
    const label = `${o.propertyAddress}, ${o.propertyCity}`
    if (o.status === 'cancelled') { skipped.push({ kind: 'order', id, label, reason: 'cancelled' }); continue }

    const address = { line1: o.propertyAddress, city: o.propertyCity, state: o.propertyState, zip: o.propertyZip }
    // One query per job — fine at ≤50, and keeps the lookup off the hot path.
    const soldBy = await resolveAssignedAgent({ placedForAgentName: o.placedForAgentName, teamId: o.user.teamId })

    const job: DispatchOrderJob = {
      kind: 'order',
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      address,
      mapsUrl: mapsUrl(address),
      scheduledDate: dayString(o.scheduledDate),
      isExpedited: o.isExpedited,
      agent: { name: o.user.fullName || o.user.name || o.user.email, phone: o.user.phone ?? null, company: o.user.company ?? null },
      soldBy,
      postType: o.postType?.name ?? null,
      propertyType: String(o.propertyType).replace(/_/g, ' '),
      installLocation: o.installationLocation ?? null,
      orientation: orientationLabel(o.signOrientation, o.signOrientationOther),
      isGated: o.isGatedCommunity,
      gateCode: o.gateCode ?? null,
      markerPlaced: o.hasMarkerPlaced,
      streetNumbersVisible: o.streetNumbersVisible ?? null,
      notes: o.propertyNotes ?? null,
      lines: o.orderItems.map((it) => ({ description: it.description, quantity: it.quantity })),
      photo: null,
      photoNote: null,
    }
    jobs.push(job)
  }

  // ---- Photos: fetched one order at a time, never in the list select ----
  let photoBudget = MAX_TOTAL_PHOTO_BYTES
  for (const job of jobs) {
    if (job.kind !== 'order') continue
    const row = await prisma.order.findUnique({ where: { id: job.id }, select: { installationLocationImage: true } })
    const uri = row?.installationLocationImage
    if (!uri) continue
    const decoded = decodeDataUri(uri)
    if (!decoded) { job.photoNote = 'photo on file could not be read — see the admin order page'; continue }
    if (decoded.content.length > MAX_PHOTO_BYTES || decoded.content.length > photoBudget) {
      job.photoNote = 'photo too large to attach — see the admin order page'
      continue
    }
    photoBudget -= decoded.content.length
    job.photo = { filename: `${job.orderNumber}-${decoded.filename}`, content: decoded.content }
  }

  // ---- Service requests ----
  const srs = input.serviceRequestIds.length
    ? await prisma.serviceRequest.findMany({ where: { id: { in: input.serviceRequestIds } }, select: DISPATCH_SR_SELECT })
    : []
  const srById = new Map(srs.map((s) => [s.id, s]))
  for (const id of input.serviceRequestIds) {
    const s = srById.get(id)
    if (!s) { skipped.push({ kind: 'service_request', id, label: id, reason: 'not_found' }); continue }
    const inst = s.installation
    const unlisted = !inst
    const onFile = !!inst || !!s.unlistedAddress
    const address = inst
      ? { line1: inst.propertyAddress, city: inst.propertyCity, state: inst.propertyState, zip: inst.propertyZip }
      : { line1: s.unlistedAddress ?? '', city: s.unlistedCity ?? '', state: s.unlistedState ?? '', zip: s.unlistedZip ?? '' }
    const label = onFile ? `${address.line1}, ${address.city}` : `service request ${id.slice(-6).toUpperCase()}`
    if (s.status === 'cancelled') { skipped.push({ kind: 'service_request', id, label, reason: 'cancelled' }); continue }

    const listingAgent = inst?.order?.placedForAgentName
      ? await resolveAssignedAgent({ placedForAgentName: inst.order.placedForAgentName, teamId: s.user.teamId })
      : null

    const job: DispatchServiceJob = {
      kind: 'service_request',
      id: s.id,
      status: s.status,
      type: labelRequestType(s.type),
      address: { ...address, unlisted, onFile },
      mapsUrl: onFile ? mapsUrl(address) : '',
      requestedDate: dayString(s.requestedDate),
      agent: { name: s.user.fullName || s.user.name || s.user.email, phone: s.user.phone ?? null, company: s.user.company ?? null },
      listingAgent,
      description: cleanServiceDescription(s.description ?? null, unlisted),
      notes: s.notes ?? null,
      installedHere: inst?.order && inst.order.orderItems.length
        ? { orderNumber: inst.order.orderNumber, lines: inst.order.orderItems.map((it) => ({ description: it.description, quantity: it.quantity })) }
        : null,
      ridersOnSite: inst ? inst.riders.map((r) => r.rider.name) : [],
      lockboxesOnSite: inst
        ? inst.lockboxes.map((lb) => ({
            type: lb.lockboxType.name,
            serialNumber: lb.customerLockbox?.serialNumber ?? null,
            code: lb.customerLockbox?.code ?? lb.code ?? null,
          }))
        : [],
    }
    jobs.push(job)
  }

  // Dated jobs first (ascending), then undated; tie-break on street so the
  // crew reads the list like a route sheet.
  const dateOf = (j: DispatchJob) => (j.kind === 'order' ? j.scheduledDate : j.requestedDate)
  jobs.sort((a, b) => {
    const da = dateOf(a), db = dateOf(b)
    if (da && db && da !== db) return da < db ? -1 : 1
    if (da && !db) return -1
    if (!da && db) return 1
    return a.address.line1.localeCompare(b.address.line1)
  })

  // Uniform redaction of every string field — see types.ts. Photo Buffers
  // pass through untouched.
  return { jobs: redactAllStrings(jobs), skipped: redactAllStrings(skipped) }
}
