'use client'

import { useCallback, useEffect, useState } from 'react'

// Cross-page selection for the installer dispatch email: tick orders on
// /admin/orders, tick trips on /admin/service-requests, send one email.
// sessionStorage on purpose — it is per-tab, so a stale morning selection
// dies with the tab and two tabs never fight over one list.
const KEY = 'admin-dispatch-selection-v1'

interface Stored {
  orderIds: string[]
  serviceRequestIds: string[]
}

const EMPTY: Stored = { orderIds: [], serviceRequestIds: [] }

function read(): Stored {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return EMPTY
    const p = JSON.parse(raw) as Partial<Stored>
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { orderIds: ids(p.orderIds), serviceRequestIds: ids(p.serviceRequestIds) }
  } catch {
    return EMPTY
  }
}

function write(s: Stored) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage blocked — selection still works for this render tree */
  }
}

export type DispatchKind = 'order' | 'service_request'

export function useDispatchSelection() {
  const [state, setState] = useState<Stored>(EMPTY)

  // Hydrate after mount so server and first client render agree.
  useEffect(() => {
    setState(read())
  }, [])

  const update = useCallback((fn: (s: Stored) => Stored) => {
    setState((prev) => {
      const next = fn(prev)
      write(next)
      return next
    })
  }, [])

  const toggle = useCallback(
    (kind: DispatchKind, id: string) =>
      update((s) => {
        const key = kind === 'order' ? 'orderIds' : 'serviceRequestIds'
        const has = s[key].includes(id)
        return { ...s, [key]: has ? s[key].filter((x) => x !== id) : [...s[key], id] }
      }),
    [update]
  )

  const setMany = useCallback(
    (kind: DispatchKind, ids: string[], on: boolean) =>
      update((s) => {
        const key = kind === 'order' ? 'orderIds' : 'serviceRequestIds'
        const set = new Set(s[key])
        for (const id of ids) on ? set.add(id) : set.delete(id)
        return { ...s, [key]: Array.from(set) }
      }),
    [update]
  )

  const clear = useCallback(() => update(() => EMPTY), [update])

  return {
    orderIds: state.orderIds,
    serviceRequestIds: state.serviceRequestIds,
    isOrderSelected: (id: string) => state.orderIds.includes(id),
    isServiceRequestSelected: (id: string) => state.serviceRequestIds.includes(id),
    toggleOrder: (id: string) => toggle('order', id),
    toggleServiceRequest: (id: string) => toggle('service_request', id),
    setMany,
    clear,
    count: state.orderIds.length + state.serviceRequestIds.length,
  }
}

export type DispatchSelection = ReturnType<typeof useDispatchSelection>
