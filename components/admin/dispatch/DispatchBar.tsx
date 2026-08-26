'use client'

import { Mail, X } from 'lucide-react'
import { Button } from '@/components/ui'
import type { DispatchSelection } from './useDispatchSelection'

interface DispatchBarProps {
  selection: DispatchSelection
  onEmail: () => void
}

// Fixed-bottom action bar — same shape as the bulk-reassign bar on the admin
// customer page. Rendered by both admin lists whenever anything is ticked.
export function DispatchBar({ selection, onEmail }: DispatchBarProps) {
  if (selection.count === 0) return null
  const o = selection.orderIds.length
  const s = selection.serviceRequestIds.length
  const parts: string[] = []
  if (o) parts.push(`${o} order${o === 1 ? '' : 's'}`)
  if (s) parts.push(`${s} service request${s === 1 ? '' : 's'}`)
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(720px,calc(100vw-2rem))]">
      <div className="bg-white border border-pink-300 shadow-lg rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-900">{parts.join(' + ')} selected</span>
        <span className="text-sm text-gray-500">·</span>
        <Button size="sm" onClick={onEmail} className="gap-2">
          <Mail className="w-4 h-4" />
          Email installers
        </Button>
        <Button size="sm" variant="outline" onClick={selection.clear}>
          <X className="w-4 h-4 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  )
}
