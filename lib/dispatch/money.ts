// Money-amount patterns shared by the dispatch redactor (lib/dispatch/types.ts),
// the send-time backstop (lib/email.ts), the admin note (the dispatch route)
// and the admin preview (DispatchEmailModal). Deliberately Buffer-free so the
// modal can import it client-side and show exactly what the crew will read.
//
// AMOUNTS only, never money words: "Price Reduced" is a stock rider and
// "Total Realty" is a company. The regression script
// (scripts/dispatch-email-preview.ts) holds the word check for the template's
// own static copy. Review 2026-08-25 found "80$", "USD 80", "$  80",
// "80-dollar" and "eighty dollars" slipping past the first cut — every form
// below is exercised by that script.
const NUMBER_WORD =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)'

export const MONEY_PATTERNS: readonly RegExp[] = [
  // $80  $ 80  $  80  $1,234.56  $5k  US$80  ＄80  €80  £80
  /[$＄€£]\s*\d[\d,]*(?:\.\d+)?k?/gi,
  // 80$  1.5k$
  /\b\d[\d,]*(?:\.\d+)?k?\s*[$＄€£]/g,
  // 80 dollars  80 dollar  80-dollar  1.5k bucks  80 USD
  /\b\d[\d,]*(?:\.\d+)?k?[\s-]*(?:dollars?|bucks|usd)\b/gi,
  // USD 80  usd80
  /\busd\s*\d[\d,]*(?:\.\d+)?k?/gi,
  // eighty dollars  one hundred fifty bucks  twenty-five dollar
  new RegExp(`\\b(?:${NUMBER_WORD}[\\s-]*)+(?:dollars?|bucks)\\b`, 'gi'),
]

export const REDACTED = '[amount removed]'

/** Replace any money amount in free text with a neutral marker. */
export function redactMoney(s: string | null | undefined): string | null {
  if (s == null) return null
  let out = s
  for (const p of MONEY_PATTERNS) out = out.replace(p, REDACTED)
  return out
}

/** True if any money amount is present. `search` ignores the g flag/lastIndex. */
export function containsMoney(s: string): boolean {
  return MONEY_PATTERNS.some((p) => s.search(p) !== -1)
}

/**
 * Final backstop on the rendered output. Throws if any money amount is
 * present anywhere — the caller must treat this as "refuse to send".
 */
export function assertNoMoney(rendered: { subject: string; text: string; html: string }): void {
  for (const [name, body] of Object.entries(rendered)) {
    if (containsMoney(body)) throw new Error(`dispatch email failed money guard (${name})`)
  }
}
