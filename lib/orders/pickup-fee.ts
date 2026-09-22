/**
 * The $10 sign-pickup fee (Ryan, 2026-09-15): charged once per order when any
 * sign on it has to be collected from another location (agent home or office)
 * instead of waiting at the listing. Waived for teams with
 * Team.pickupFeeWaived ("Semonin mainly") — that lookup is server-only and
 * lives in ./pickup-fee-waiver.
 *
 * Pure (no DB): the order routes run the policy, and the edit screens use
 * lockedPickupFeeDecision so what they preview is what the edit route charges.
 *
 * Item prices are otherwise trusted from the client across the order routes
 * (see the comment near the top of app/api/orders/[id]/edit/route.ts). This
 * fee is the exception: it is new money on live Stripe with a per-account
 * waiver, so the server decides it from the sign lines and ignores whatever
 * fee line the client sent.
 */
import { PICKUP_FEE } from './pricing'
import { PICKUP_FEE_DESCRIPTION, sanitizePickupAddress, signInstallDescription } from './sign-descriptions'

interface PolicyItem {
  item_type: string
  item_category?: string | null
  description: string
  quantity: number
  unit_price: number
  total_price: number
  custom_value?: string | null
}

export const PICKUP_ADDRESS_REQUIRED = 'Please enter the pickup address for the sign.'

export interface PickupFeeDecision {
  waived: boolean
  // Fee to charge when not waived. Defaults to PICKUP_FEE; an edit passes the
  // amount the order was placed at, so a later price change can't reprice it.
  amount?: number
}

/**
 * Normalise the sign lines and rebuild the pickup fee from scratch:
 *   - every `pickup` sign line gets a sanitised address in custom_value and the
 *     canonical description (so the crew always sees the address), or the whole
 *     order is refused when the address is blank. The address is read from
 *     custom_value ONLY — never parsed back out of the client's description;
 *   - every client-sent `pickup_fee` line is dropped;
 *   - exactly one canonical fee line is appended iff a pickup sign remains and
 *     the decision is not waived.
 * Idempotent, so running it on every edit re-derives the same fee.
 */
export function applyPickupFeePolicy<T extends PolicyItem>(
  items: T[],
  decision: PickupFeeDecision,
): { items: T[]; error?: string } {
  let hasPickup = false
  const out: T[] = []
  for (const item of items) {
    if (item.item_type === 'pickup_fee') continue
    if (item.item_type === 'sign' && (item.item_category === 'pickup' || item.item_category === 'delivered')) {
      const secondPost = typeof item.description === 'string' && item.description.startsWith('Second Post')
      if (item.item_category === 'pickup') {
        const address = sanitizePickupAddress(item.custom_value)
        if (!address) return { items, error: PICKUP_ADDRESS_REQUIRED }
        hasPickup = true
        out.push({ ...item, custom_value: address, description: signInstallDescription('pickup', address, secondPost) })
      } else {
        out.push({ ...item, description: signInstallDescription('ppi_storage', null, secondPost) })
      }
      continue
    }
    out.push(item)
  }
  if (hasPickup && !decision.waived) {
    const amount = decision.amount ?? PICKUP_FEE
    out.push({
      item_type: 'pickup_fee',
      item_category: undefined,
      description: PICKUP_FEE_DESCRIPTION,
      quantity: 1,
      unit_price: amount,
      total_price: amount,
    } as unknown as T)
  }
  return { items: out }
}

/**
 * For an EDIT: if the order already has a pickup sign, the fee decision made
 * at placement stands — the fee it was charged (or its waiver) carries over,
 * whatever the team's waiver says today. Otherwise ticking or unticking the
 * waiver in admin would move $10 on the next unrelated edit, even a date-only
 * one (a phantom refund, or a surprise charge). Same rule as the out-of-area
 * exempt-promotion guard in the edit route, and the fuel / flat-fee rate
 * locks: account changes apply to future orders, not open ones.
 *
 * Returns null when the order has no pickup sign yet — then the payer's
 * CURRENT waiver decides, because this edit is what adds the pickup.
 */
export function lockedPickupFeeDecision(
  existingItems: ReadonlyArray<{ itemType: string; itemCategory?: string | null; totalPrice: unknown }>,
): PickupFeeDecision | null {
  const hadPickupSign = existingItems.some(i => i.itemType === 'sign' && i.itemCategory === 'pickup')
  if (!hadPickupSign) return null
  const feeLine = existingItems.find(i => i.itemType === 'pickup_fee')
  if (!feeLine) return { waived: true }
  const amount = Number(feeLine.totalPrice)
  return Number.isFinite(amount) && amount > 0 ? { waived: false, amount } : { waived: true }
}
