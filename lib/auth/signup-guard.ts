// Bot sign-ups (Ryan, 2026-10-15): "ZkbxNrmICojfIdEvehIhjtf" with
// de.c.u.c.i.r.a.z.40@gmail.com and a random phone. The checks are narrow on
// purpose: a real agent never trips them, and anyone who somehow does is told
// to call or text instead of being silently dropped.

// Hidden on the sign-up form. People never see it; form-filling bots fill
// every field they find.
export const HONEYPOT_FIELD = 'website_url'

export type BotSignupReason = 'honeypot' | 'random_name' | 'dotted_gmail'

export function botSignupReason(input: {
  fullName: unknown
  email: unknown
  honeypot?: unknown
}): BotSignupReason | null {
  if (typeof input.honeypot === 'string' && input.honeypot.trim()) return 'honeypot'

  const name = String(input.fullName ?? '').trim()
  // One long mixed-case "word" with capitals scattered through it. Real names
  // with inner capitals (McDonald, DeMarco) have one or two, full names have a
  // space, and a name typed in all caps has no lowercase.
  const innerCapitals = (name.slice(1).match(/[A-Z]/g) ?? []).length
  if (!/\s/.test(name) && name.length >= 12 && innerCapitals >= 4 && /[a-z]/.test(name)) return 'random_name'

  // Gmail ignores dots, so bots pad one inbox into endless "new" addresses.
  const [local = '', domain = ''] = String(input.email ?? '').toLowerCase().trim().split('@')
  if ((domain === 'gmail.com' || domain === 'googlemail.com') && (local.match(/\./g) ?? []).length >= 4) {
    return 'dotted_gmail'
  }
  return null
}
