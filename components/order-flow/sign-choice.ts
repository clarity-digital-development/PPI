import type { OrderFormData } from './types'

/**
 * Completeness of the sign choices (Ryan, 2026-09-15). Shared by the wizard's
 * Continue gate and the Review step's save guards: edit mode and cart re-edit
 * unlock every step, so Review can be reached without the Sign step's
 * Continue ever running.
 *
 * Deliberately does NOT re-check "from inventory but no sign picked" here —
 * that stays a Continue-only gate, as before. Orders placed long ago can read
 * back as 'stored' with no sign id, and refusing them at Review would stop
 * those orders from being edited at all.
 */
export function signChoiceProblem(fd: OrderFormData): string | null {
  if (!fd.sign_option) return 'Please choose a sign option on the Sign step.'
  if (fd.sign_option === 'at_property') {
    if (!fd.sign_location) return 'Please choose where the sign will be on the Sign step.'
    if (fd.sign_location === 'pickup' && !fd.sign_pickup_address?.trim()) {
      return 'Please enter the sign pickup address on the Sign step.'
    }
  }
  if (fd.second_post_enabled && fd.second_post_sign_option === 'at_property') {
    if (!fd.second_post_sign_location) return "Please choose where the second post's sign will be."
    if (fd.second_post_sign_location === 'pickup' && !fd.second_post_pickup_address?.trim()) {
      return "Please enter the pickup address for the second post's sign."
    }
  }
  return null
}

export function mainSignIsPickup(fd: OrderFormData): boolean {
  return fd.sign_option === 'at_property' && fd.sign_location === 'pickup'
}

export function secondSignIsPickup(fd: OrderFormData): boolean {
  return fd.second_post_enabled && fd.second_post_sign_option === 'at_property' && fd.second_post_sign_location === 'pickup'
}
