/**
 * Out-of-area pickup lines on bundled invoices (Ryan, 2026-09-28).
 *
 * Invoice accounts split the out-of-area fee like card accounts: half rides on
 * the order, and the pickup half is queued as 'pending_invoice' when removal
 * is scheduled (lib/orders/out-of-area-charge.ts). Every bundler — admin
 * preview, admin send, broker self-serve — picks queued halves up through the
 * ONE predicate here, so a preview can never show a different set of lines
 * from the invoice that gets sent (the same reason invoiceDiscount is shared).
 *
 * A pickup line sits in the invoice SUBTOTAL, like a service trip: untaxed, no
 * fuel, and covered by the broker discount exactly as the install half is
 * inside its order. It is not a post-invoice "adjustment" (total-only, never
 * discounted).
 *
 * The line is read live from Order.serviceAreaSecondChargeCents via
 * Order.serviceAreaSecondChargeInvoiceId, and the edit route never re-arms a
 * half once it is queued or billed, so a sent invoice always reads the same.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { InvoicePickup } from './invoice-pdf'

type Db = Prisma.TransactionClient | typeof prisma

export type PreviouslyBilledScope =
  // Every queued pickup this account owes (admin bundles, unfiltered broker bundles).
  | { kind: 'all' }
  // A broker bundle filtered to one agent: that agent's pickups only, so agent
  // A's pickup never lands on the invoice the broker cut for agent B.
  | { kind: 'agent'; agent: string }
  // A price-filtered broker bundle: only pickups whose order is on THIS
  // invoice. The rest wait for an unfiltered bundle.
  | { kind: 'none' }

/**
 * Queued pickup halves that belong on an invoice for `ownerId`.
 *
 * A half is billed to whoever pays for the order (placedByUserId ?? userId),
 * once the order itself has been billed — either it's being bundled onto this
 * invoice now (`bundlingOrderIds`), or it isn't sitting unbundled on the
 * invoice queue (already invoiced, or paid by card before the account moved
 * to invoice billing). A pickup never lands on an invoice ahead of its own
 * install.
 */
export function ooaPickupSweepWhere(
  ownerId: string,
  bundlingOrderIds: string[],
  scope: PreviouslyBilledScope,
): Prisma.OrderWhereInput {
  const previouslyBilled: Prisma.OrderWhereInput[] =
    scope.kind === 'none'
      ? []
      : [
          {
            AND: [
              { OR: [{ placedByUserId: ownerId }, { placedByUserId: null, userId: ownerId }] },
              { OR: [{ invoiceId: { not: null } }, { paymentStatus: { not: 'pending_invoice' } }] },
              ...(scope.kind === 'agent' ? [{ placedForAgentName: scope.agent }] : []),
            ],
          },
        ]
  return {
    serviceAreaSecondChargeStatus: 'pending_invoice',
    serviceAreaSecondChargeInvoiceId: null,
    serviceAreaSecondChargeCents: { gt: 0 },
    status: { not: 'cancelled' },
    OR: [{ id: { in: bundlingOrderIds } }, ...previouslyBilled],
  }
}

export const ooaPickupSelect = {
  id: true,
  orderNumber: true,
  propertyAddress: true,
  propertyCity: true,
  propertyState: true,
  propertyZip: true,
  placedForAgentName: true,
  serviceAreaSecondChargeCents: true,
  installation: { select: { removalDate: true } },
} satisfies Prisma.OrderSelect

export type OOAPickupRow = Prisma.OrderGetPayload<{ select: typeof ooaPickupSelect }>

export async function findSweepableOOAPickups(
  db: Db,
  ownerId: string,
  bundlingOrderIds: string[],
  scope: PreviouslyBilledScope,
): Promise<OOAPickupRow[]> {
  return db.order.findMany({
    where: ooaPickupSweepWhere(ownerId, bundlingOrderIds, scope),
    select: ooaPickupSelect,
    orderBy: { createdAt: 'asc' },
  })
}

/** Summed in integer cents — the bundlers divide once. */
export function ooaPickupCents(rows: Array<{ serviceAreaSecondChargeCents: number | null }>): number {
  return rows.reduce((s, r) => s + (r.serviceAreaSecondChargeCents ?? 0), 0)
}

/**
 * Claim each pickup for `invoiceId`, only if it is still queued, unclaimed,
 * and at the amount the invoice total was computed from. Any mismatch — a
 * parallel bundle got there first, or the row changed mid-bundle — throws
 * with the 'Concurrent bundle race' prefix both bundlers already map to a 409,
 * rolling the whole invoice back (same policy as the adjustment sweep).
 */
export async function attachOOAPickups(tx: Prisma.TransactionClient, rows: OOAPickupRow[], invoiceId: string): Promise<void> {
  for (const p of rows) {
    const claimed = await tx.order.updateMany({
      where: {
        id: p.id,
        serviceAreaSecondChargeStatus: 'pending_invoice',
        serviceAreaSecondChargeInvoiceId: null,
        serviceAreaSecondChargeCents: p.serviceAreaSecondChargeCents,
      },
      data: { serviceAreaSecondChargeInvoiceId: invoiceId },
    })
    if (claimed.count !== 1) {
      throw new Error(`Concurrent bundle race: out-of-area pickup on ${p.orderNumber} changed mid-bundle`)
    }
  }
}

export function toInvoicePickup(row: OOAPickupRow): InvoicePickup {
  return {
    order_id: row.id,
    order_number: row.orderNumber,
    property_address: row.propertyAddress,
    property_city: row.propertyCity,
    property_state: row.propertyState,
    property_zip: row.propertyZip,
    placed_for_agent_name: row.placedForAgentName,
    removal_date: row.installation?.removalDate?.toISOString() ?? null,
    amount: (row.serviceAreaSecondChargeCents ?? 0) / 100,
  }
}

/** "1 out-of-area pickup" / "3 out-of-area pickups" — for count lines. */
export function ooaPickupCountLabel(n: number): string {
  return `${n} out-of-area pickup${n === 1 ? '' : 's'}`
}
