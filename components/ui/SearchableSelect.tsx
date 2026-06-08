'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

// Estimated popover height (search input + ~6 rows) used for flip-up decision.
const POPOVER_ESTIMATE_PX = 320

interface PopoverPos {
  left: number
  top: number
  width: number
  placement: 'below' | 'above'
}

export interface SearchableSelectOption {
  value: string
  label: string
}

export interface SearchableSelectProps {
  value: string
  onChange: (next: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
  label?: string
  emptyText?: string
  'aria-label'?: string
}

const SearchableSelect = ({
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  searchPlaceholder = 'Search...',
  disabled = false,
  className,
  label,
  emptyText = 'No matches',
  'aria-label': ariaLabel,
}: SearchableSelectProps) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // Reset highlight when filter changes and clamp into bounds.
  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  // Click-outside closes — must check BOTH trigger and portaled popover (popover is no longer a DOM child of containerRef).
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      const inTrigger = containerRef.current?.contains(target)
      const inPopover = popoverRef.current?.contains(target)
      if (!inTrigger && !inPopover) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Compute popover position from trigger rect; flip above when bottom space is tight.
  const computePos = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const placement: 'below' | 'above' =
      spaceBelow < POPOVER_ESTIMATE_PX && r.top > spaceBelow ? 'above' : 'below'
    setPos({
      left: r.left,
      // 4px gap mirrors the previous mt-1; for 'above' we anchor top to trigger top and translateY(-100%) in style.
      top: placement === 'below' ? r.bottom + 4 : r.top - 4,
      width: r.width,
      placement,
    })
  }

  // Position synchronously before paint so the portal doesn't flash at (0,0).
  useLayoutEffect(() => {
    if (open) computePos()
    else setPos(null)
  }, [open])

  // Close on scroll/resize so the floating popover never detaches from its trigger.
  useEffect(() => {
    if (!open) return
    const close = (e?: Event) => {
      // Ignore scrolls originating inside the popover — let the option list scroll independently.
      if (e && e.type === 'scroll' && popoverRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setQuery('')
    }
    // Capture-phase scroll catches scrolls in any ancestor (modal body, page, etc.).
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // Focus the search input when the popover opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep highlighted item scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLLIElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[highlight]
      if (opt) pick(opt.value)
    }
  }

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      )}
      <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => !disabled && setOpen((o) => !o)}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 text-left',
            'text-sm font-medium text-gray-900',
            'shadow-sm hover:border-gray-400 hover:bg-gray-50/50',
            'focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 focus:bg-white',
            'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
            'transition-all duration-150 cursor-pointer',
            className,
          )}
        >
          <span className={cn('truncate', !selected && 'text-gray-400 font-normal')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
        </button>

        {open && pos && typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={popoverRef}
              onKeyDown={onKeyDown}
              // Portaled to body so no ancestor overflow can clip; z-[60] sits above z-50 modals.
              className="fixed z-[60] min-w-[200px] rounded-lg border border-gray-200 bg-white shadow-lg"
              style={{
                left: pos.left,
                top: pos.top,
                width: pos.width,
                transform: pos.placement === 'above' ? 'translateY(-100%)' : undefined,
              }}
            >
              <div className="relative border-b border-gray-100 p-2">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="block w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-500"
                />
              </div>
              <ul
                ref={listRef}
                role="listbox"
                className="max-h-60 overflow-y-auto py-1"
              >
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-500 italic">{emptyText}</li>
                ) : (
                  filtered.map((opt, idx) => {
                    const isSelected = opt.value === value
                    const isHighlight = idx === highlight
                    return (
                      <li
                        key={opt.value}
                        data-idx={idx}
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setHighlight(idx)}
                        onMouseDown={(e) => {
                          // Use mousedown so the click happens before the input's blur/click-outside.
                          e.preventDefault()
                          pick(opt.value)
                        }}
                        className={cn(
                          'cursor-pointer px-3 py-2 text-sm',
                          isHighlight ? 'bg-pink-50 text-pink-700' : 'text-gray-700',
                          isSelected && 'font-medium',
                        )}
                      >
                        {opt.label}
                      </li>
                    )
                  })
                )}
              </ul>
            </div>,
            document.body,
          )}
      </div>
    </div>
  )
}

export { SearchableSelect }
