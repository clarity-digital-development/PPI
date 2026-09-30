import type { StepProps } from './types'

type StoredSign = NonNullable<StepProps['inventory']>['signs'][number]

/**
 * The stored-sign dropdown shared by the main post (sign-step) and the second
 * post (second-post-step).
 *
 * Signs are grouped by description so duplicates only appear once -- but keyed
 * on description AND source. A brokerage pool (Ryan, 2026-09-08) can hold a
 * sign described identically to the agent's own; grouping on description alone
 * collapsed the two into a single option carrying whichever id sorted first,
 * so the agent could never actually choose the brokerage sign and might
 * consume the wrong physical one.
 *
 * Each option carries ONE physical sign's id, so the two posts must never be
 * handed the same one: a broker with ten identical "For Sale" signs in general
 * stock picked "For Sale" for both posts, both lines carried the same sign,
 * and adding the order to the cart failed on every try (the second reservation
 * collided with the first). `takenId` is the sign the OTHER post already uses;
 * it's skipped so the group falls to the next identical sign — or disappears
 * when that was the only one. `selectedId` (this post's own pick) is preferred
 * as the group's id so the dropdown keeps showing it.
 */
export function storedSignOptions(
  signs: StoredSign[],
  { selectedId, takenId }: { selectedId?: string; takenId?: string },
): Array<{ value: string; label: string }> {
  const grouped: Record<string, { id: string; label: string }> = {}
  for (const sign of signs) {
    if (takenId && sign.id === takenId) continue
    const base = `${sign.description}${sign.size ? ` (${sign.size})` : ''}`
    // 'on-order' is the row this order already holds. It gets its own option
    // so it can never mask a same-described sign from either pool, and is
    // labelled so the agent can tell it apart.
    const label =
      sign.source === 'brokerage'
        ? `${base} — ${sign.source_label || 'Brokerage'}`
        : sign.source === 'on-order'
          ? `${base} — currently on this order`
          : base
    const key = `${base}::${sign.source ?? 'own'}`
    if (!grouped[key] || sign.id === selectedId) grouped[key] = { id: sign.id, label }
  }
  return Object.values(grouped).map((g) => ({ value: g.id, label: g.label }))
}
