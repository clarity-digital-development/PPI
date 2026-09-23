/**
 * Deliberate aborts thrown from inside a bundle transaction.
 *
 * Both bundlers refuse to create an invoice that can't be collected (a Stripe
 * Payment Link needs a positive amount), and both want the admin or broker to
 * SEE why rather than get a bare 500. That used to be matched by
 * `msg.startsWith('Pending adjustments')`, which silently stopped working the
 * moment a second reason existed — the broker discount can push a total to
 * zero with no adjustments in play at all. Tagging the error instead of
 * sniffing its prose means a new reason can never slip past the handler.
 */
const MARKER = 'UNCOLLECTABLE_INVOICE: '

/** Throwable: carries a message meant for a human, behind a stable tag. */
export function uncollectableInvoice(message: string): Error {
  return new Error(MARKER + message)
}

/** The human message if this was one of ours, otherwise null. */
export function uncollectableMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : ''
  return msg.startsWith(MARKER) ? msg.slice(MARKER.length) : null
}
