/**
 * 50/50 split invoices (Ryan, 2026-11-09): a lender and a title company share
 * one account and each pay half of its bill. When the account has the split
 * on (both parties' emails set), each new invoice gets two InvoicePayment
 * rows — one per party — snapshotted at creation.
 */

export interface SplitSettings {
  invoiceSplitEnabled: boolean
  invoiceSplitAName: string | null
  invoiceSplitAEmail: string | null
  invoiceSplitBName: string | null
  invoiceSplitBEmail: string | null
}

export interface SplitHalfInput {
  half: 'A' | 'B'
  payerName: string
  payerEmail: string
  amountCents: number
}

/** Prisma select for the account fields the split needs. */
export const splitSettingsSelect = {
  invoiceSplitEnabled: true,
  invoiceSplitAName: true,
  invoiceSplitAEmail: true,
  invoiceSplitBName: true,
  invoiceSplitBEmail: true,
} as const

/**
 * Stripe won't take a card payment under $0.50, so a half below that could
 * never be paid online. An invoice too small to give BOTH halves at least
 * this much is sent as one normal (unsplit) invoice instead.
 */
export const MIN_SPLIT_TOTAL_CENTS = 100

/**
 * The two halves for an invoice of `totalCents`, or null when the account
 * doesn't split (or isn't fully set up — both emails are required), or the
 * invoice is too small to split (see MIN_SPLIT_TOTAL_CENTS). Half A takes
 * the odd cent so A + B always equals the total exactly.
 */
export function splitHalvesFor(totalCents: number, s: SplitSettings): SplitHalfInput[] | null {
  if (!s.invoiceSplitEnabled) return null
  const aEmail = s.invoiceSplitAEmail?.trim()
  const bEmail = s.invoiceSplitBEmail?.trim()
  if (!aEmail || !bEmail) return null
  if (!Number.isInteger(totalCents) || totalCents < MIN_SPLIT_TOTAL_CENTS) return null
  const a = Math.ceil(totalCents / 2)
  return [
    { half: 'A', payerName: s.invoiceSplitAName?.trim() || aEmail, payerEmail: aEmail, amountCents: a },
    { half: 'B', payerName: s.invoiceSplitBName?.trim() || bEmail, payerEmail: bEmail, amountCents: totalCents - a },
  ]
}
