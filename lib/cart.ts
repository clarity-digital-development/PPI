'use client'

import { useState, useEffect, useCallback } from 'react'
import type { OrderFormData } from '@/components/order-flow/types'

/**
 * localStorage-backed cart for team_admin / admin use:
 * the admin builds N "draft orders" (each for a possibly-different agent)
 * and checks out all at once. Each draft becomes a real Order via POST
 * /api/orders at checkout time, with payment going to the admin's card.
 *
 * Per-customer cart — keyed by the actor's user id (which we don't know
 * client-side, so we keep a single key per browser).
 */

export interface CartItem {
  /** Stable id for the cart row */
  id: string
  /** Agent this order is for (used as on_behalf_of_user_id at checkout) */
  agentId: string
  agentName: string
  agentEmail: string
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

  const removeItem = useCallback((id: string) => {
    const next = readCart().filter(i => i.id !== id)
    writeCart(next)
    setItems(next)
  }, [])

  const clearCart = useCallback(() => {
    writeCart([])
    setItems([])
  }, [])

  return { items, loaded, addItem, removeItem, clearCart, count: items.length }
}

export function getCartCount(): number {
  return readCart().length
}
