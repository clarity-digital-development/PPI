'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { OrderFormData } from '@/components/order-flow/types'
import { getOrCreateCartSessionId } from '@/lib/cart-session'

/**
 * localStorage-backed cart for team_admin / admin use:
 * the admin builds N "draft orders" (each for a possibly-different agent)
 * and checks out all at once. Each draft becomes a real Order via POST
 * /api/orders at checkout time, with payment going to the admin's card.
 *
 * Per-customer cart — keyed by the actor's user id (which we don't know
 * client-side, so we keep a single key per browser).
 *
 * Inventory holds: every cart row carries holdIds — a map from
 * `customer_*_id` field name to the InventoryHold.id reserving that
 * inventory item for 15 min. removeItem/clearCart release the holds
 * server-side. The cart page heartbeats to extend TTL while visible.
 */

export interface CartItem {
  /** Stable id for the cart row */
  id: string
  /**
   * Agent this order is for. Historically used as on_behalf_of_user_id at
   * checkout, but the value semantics are mixed:
   *  - team_admin gate path: this is a TeamMember.id (NOT a User.id)
   *  - legacy admin on_behalf_of= path: this is a User.id
   * Prefer the discriminated fields below (placedForMemberId vs
   * onBehalfOfUserId) for new code — agentId is kept for back-compat with
   * existing localStorage rows.
   */
  agentId: string
  agentName: string
  agentEmail: string
  /**
   * Set when the row was created via the team_admin agent-picker gate.
   * The TeamMember.id, not a User.id. Used by cart's "Next order" URL to
   * route back to /dashboard/place-order?team_member_id= so the same
   * member is pre-selected without re-running the picker, and avoids the
   * 403 that resulted from stuffing a TeamMember.id into ?on_behalf_of=.
   */
  placedForMemberId?: string
  /** Snapshot of the wizard form state at time of "Add to cart" */
  formData: OrderFormData
  /** Items array that the API expects (mirror of what review-step builds) */
  items: Array<Record<string, unknown>>
  /** Estimated total for display purposes — final tax/total comes from API */
  estimatedTotal: number
  /** Property summary for the cart list */
  propertyAddress: string
  /** ISO timestamp the draft was added */
  addedAt: string
  /**
   * Inventory hold ids reserving this cart row's inventory, keyed by the
   * inventory column they refer to. Example:
   *   { customer_sign_id: 'cmpx...', customer_lockbox_id: 'cmpy...' }
   */
  holdIds?: Record<string, string>
  /**
   * ISO timestamp when this row's holds expire (earliest of the hold TTLs).
   * Updated by the heartbeat. Used by the cart UI to render countdowns.
   */
  holdsExpireAt?: string
}

const STORAGE_KEY = 'pp_cart_v1'

function readCart(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function writeCart(items: CartItem[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    // Notify other components in the same tab
    window.dispatchEvent(new Event('pp_cart_change'))
  } catch (err) {
    console.error('Failed to write cart:', err)
  }
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])
  const [loaded, setLoaded] = useState(false)

  // Load on mount + listen for cross-component updates
  useEffect(() => {
    setItems(readCart())
    setLoaded(true)

    const refresh = () => setItems(readCart())
    window.addEventListener('storage', refresh)
    window.addEventListener('pp_cart_change', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('pp_cart_change', refresh)
    }
  }, [])

  const addItem = useCallback((item: Omit<CartItem, 'id' | 'addedAt'>) => {
    const newItem: CartItem = {
      ...item,
      id: `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      addedAt: new Date().toISOString(),
    }
    const next = [...readCart(), newItem]
    writeCart(next)
    setItems(next)
    return newItem
  }, [])

  /**
   * Update a cart row in place (used by the heartbeat to refresh
   * holdsExpireAt without re-mounting the row).
   */
  const updateItem = useCallback((id: string, patch: Partial<CartItem>) => {
    const next = readCart().map(i => (i.id === id ? { ...i, ...patch } : i))
    writeCart(next)
    setItems(next)
  }, [])

  const removeItem = useCallback((id: string) => {
    // Fire-and-forget hold release. If the network fails, the sweeper
    // will reap on TTL — never block the UI.
    fetch(`/api/inventory/holds?cart_item_id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch(err => console.error('Failed to release hold for cart row:', err))
    const next = readCart().filter(i => i.id !== id)
    writeCart(next)
    setItems(next)
  }, [])

  const clearCart = useCallback(() => {
    // Release ALL my live holds — fire-and-forget.
    fetch('/api/inventory/holds?owner_user_id=me', { method: 'DELETE' })
      .catch(err => console.error('Failed to release holds on cart clear:', err))
    writeCart([])
    setItems([])
  }, [])

  return { items, loaded, addItem, updateItem, removeItem, clearCart, count: items.length }
}

/**
 * Heartbeat that extends inventory hold TTLs while the cart is open and
 * the tab is visible. Per UX critic feedback: visibilitychange-aware
 * (background-tab throttling kills setInterval after a few minutes; iOS
 * BFCache fires accumulated callbacks on resume), so we ALSO fire on
 * visibility transitions and on first mount.
 *
 * Updates each row's holdsExpireAt so the cart UI can render countdowns
 * without re-fetching from the server. Calls onConflict(cartItemId) if
 * a row's holds couldn't be extended (caller renders a re-pick prompt).
 *
 * Returns a manual `refresh()` for "I just remembered" UX triggers.
 */
export function useHoldHeartbeat(opts: {
  items: CartItem[]
  updateItem: (id: string, patch: Partial<CartItem>) => void
  onConflict?: (cartItemId: string) => void
  /** ms between heartbeats while visible; default ~4 min */
  intervalMs?: number
  /** disable the heartbeat (e.g. while a checkout is in flight) */
  enabled?: boolean
}) {
  const { items, updateItem, onConflict, enabled = true } = opts
  const intervalMs = opts.intervalMs ?? 4 * 60_000

  // Latch the latest cart-item ids so the timer always sends the current set.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const updateItemRef = useRef(updateItem)
  updateItemRef.current = updateItem
  const onConflictRef = useRef(onConflict)
  onConflictRef.current = onConflict

  const bump = useCallback(async () => {
    const live = itemsRef.current
    const cartItemIds = live.map(i => i.id)
    if (cartItemIds.length === 0) return
    try {
      const res = await fetch('/api/inventory/holds/bump', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_item_ids: cartItemIds }),
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        bumped: number
        byCartItem: Record<string, { extended: true; expiresAt: string } | { extended: false; reason: string }>
      }
      for (const ci of cartItemIds) {
        const r = data.byCartItem?.[ci]
        if (r?.extended) {
          updateItemRef.current(ci, { holdsExpireAt: r.expiresAt })
        } else {
          // Missing entry OR explicit extended:false → treat as conflict.
          // The previous "ignore missing" path created silent zombie rows
          // that passed client-side checks and 409'd at checkout.
          onConflictRef.current?.(ci)
        }
      }
    } catch (err) {
      console.error('Hold heartbeat failed:', err)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return

    // Initial bump on mount.
    void bump()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void bump()
    }
    document.addEventListener('visibilitychange', onVisible)

    let timer: ReturnType<typeof setInterval> | null = null
    const startTimer = () => {
      stopTimer()
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void bump()
      }, intervalMs)
    }
    const stopTimer = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    startTimer()

    return () => {
      stopTimer()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, intervalMs, bump])

  return { refresh: bump }
}

export function getCartCount(): number {
  return readCart().length
}
