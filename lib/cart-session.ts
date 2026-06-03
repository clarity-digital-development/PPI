'use client'

/**
 * Cart session id — single switch point.
 *
 * Today: a uuid we mint into localStorage so server-side hold records can
 * cluster reservations per browser session.
 *
 * Tomorrow (track #4 — server-side per-session Cart): replace the body of
 * getOrCreateCartSessionId() to read from the Cart table instead. Every
 * other module asks this helper — they don't read pp_cart_session_v1 directly.
 */

const STORAGE_KEY = 'pp_cart_session_v1'

function randomId(): string {
  // 16 hex chars is plenty for the lifetime of a cart session.
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return Math.random().toString(36).slice(2, 18)
}

export function getOrCreateCartSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = window.localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = randomId()
    window.localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

export function clearCartSessionId(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}
