/**
 * Post-rental lines on bundled invoices (Ryan, 2026-09-28: "charge to card on
 * file when it happens or have it add to invoice").
 *
 * An invoice account's rental is never charged to a card: the post-rental
 * cron queues each due period as 'pending_invoice' instead
 * (app/api/cron/post-rental-billing). Every bundler — admin preview, admin
 * send, broker self-serve — picks queued rentals up through the ONE predicate
 * here, so a preview never shows different lines from the invoice that gets
 * sent. Same shape and rules as the out-of-area pickup lines
 * (./ooa-pickups.ts), including which invoice a line belongs on.
 *
 * A rental line sits in the invoice SUBTOTAL like a pickup: no tax (card
 * rental charges carry none either), no fuel, and covered by the broker
 * discount. Its amount is read live from PostRentalCharge.amountCents via
 * PostRentalCharge.invoiceId, and nothing rewrites a row once it's queued, so
 * a sent invoice always reads the same.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { InvoiceRental } from './invoice-pdf'
import type { PreviouslyBilledScope } from './ooa-pickups'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Queued rentals that belong on an invoice for `ownerId`: billed to whoever
 * pays for the order (placedByUserId ?? userId), once the order itself has
 * been billed — it's being bundled onto this invoice now, or it isn't sitting
 * unbundled on the invoice queue. `scope` slices them exactly as it slices
 * pickups (an agent-filtered broker bundle takes that agent's only; a
 * price-filtered one only those whose order is on this invoice).
 */
export function postRentalSweepWhere(
  ownerId: string,
  bundlingOrderIds: string[],
  scope: PreviouslyBilledScope,
): Prisma.PostRentalChargeWhereInput {
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
    status: 'pending_invoice',
    invoiceId: null,
    amountCents: { gt: 0 },
    order: {
      status: { not: 'cancelled' },
      // Safety net: disabling an order's rental cancels its queued rows, but
      // a row queued by a cron run racing that toggle must not bill either.
      postRentalDisabled: false,
      OR: [{ id: { in: bundlingOrderIds } }, ...previouslyBilled],
    },
  }
}

export const postRentalLineSelect = {
  id: true,
  amountCents: true,
  chargeType: true,
  periodStart: true,
  periodEnd: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      propertyAddress: true,
      propertyCity: true,
      propertyState: true,
      propertyZip: true,
      placedForAgentName: true,
    },
  },
} satisfies Prisma.PostRentalChargeSelect

export type PostRentalLineRow = Prisma.PostRentalChargeGetPayload<{ select: typeof postRentalLineSelect }>

export async function findSweepablePostRentals(
  db: Db,
  ownerId: string,
  bundlingOrderIds: string[],
  scope: PreviouslyBilledScope,
): Promise<PostRentalLineRow[]> {
  return db.postRentalCharge.findMany({
    where: postRentalSweepWhere(ownerId, bundlingOrderIds, scope),
    select: postRentalLineSelect,
    orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
  })
}

/** Summed in integer cents — the bundlers divide once. */
export function postRentalCents(rows: Array<{ amountCents: number }>): number {
  return rows.reduce((s, r) => s + r.amountCents, 0)
}

/**
 * Claim each rental for `invoiceId`, only if it is still queued, unclaimed and
 * at the amount the invoice total was computed from. Any mismatch throws with
 * the 'Concurrent bundle race' prefix both bundlers already map to a 409,
 * rolling the whole invoice back (same policy as attachOOAPickups).
 */
export async function attachPostRentals(tx: Prisma.TransactionClient, rows: PostRentalLineRow[], invoiceId: string): Promise<void> {
  for (const r of rows) {
    const claimed = await tx.postRentalCharge.updateMany({
      where: { id: r.id, status: 'pending_invoice', invoiceId: null, amountCents: r.amountCents },
      data: { invoiceId },
    })
    if (claimed.count !== 1) {
      throw new Error(`Concurrent bundle race: post rental on ${r.order.orderNumber} changed mid-bundle`)
    }
  }
}

export function toInvoiceRental(row: PostRentalLineRow): InvoiceRental {
  return {
    charge_id: row.id,
    order_id: row.order.id,
    order_number: row.order.orderNumber,
    property_address: row.order.propertyAddress,
    property_city: row.order.propertyCity,
    property_state: row.order.propertyState,
    property_zip: row.order.propertyZip,
    placed_for_agent_name: row.order.placedForAgentName,
    period_start: row.periodStart.toISOString(),
    period_end: row.periodEnd.toISOString(),
    amount: row.amountCents / 100,
  }
}

/** "1 post rental charge" / "3 post rental charges" — for count lines. */
export function postRentalCountLabel(n: number): string {
  return `${n} post rental charge${n === 1 ? '' : 's'}`
}
