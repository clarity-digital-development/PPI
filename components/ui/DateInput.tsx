'use client'

import { useEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'
import { Calendar as CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DateInputProps {
  label?: string
  value: string                       // YYYY-MM-DD
  onChange: (v: string) => void       // emits YYYY-MM-DD
  min?: string                        // YYYY-MM-DD
  max?: string                        // YYYY-MM-DD
  placeholder?: string
  className?: string
}

/**
 * Branded date input — read-only text field that opens a react-day-picker
 * popover styled to match the Pink Posts pink palette. Replaces the native
 * `<input type="date">` so the popup matches the rest of the UI (Chrome's
 * default date picker can't be CSS-themed).
 *
 * Value contract is the same as the native input: ISO-ish YYYY-MM-DD string.
 */
export function DateInput({ label, value, onChange, min, max, placeholder = 'Select date', className }: DateInputProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Parse / format helpers — kept simple to avoid TZ drift. The string is
  // always local-calendar YYYY-MM-DD; we treat it as such on both sides.
  const parsed = value ? parseLocalYMD(value) : undefined
  const minDate = min ? parseLocalYMD(min) : undefined
  const maxDate = max ? parseLocalYMD(max) : undefined

  const display = parsed
    ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <div className={cn('w-full', className)} ref={wrapperRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-left',
            'text-gray-900 placeholder:text-gray-400',
            'focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent',
            'transition-all duration-200',
            !display && 'text-gray-400',
          )}
        >
          <span className="block pr-8 truncate">{display || placeholder}</span>
          <CalendarIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </button>

        {open && (
          <div className="absolute z-50 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
            <DayPicker
              mode="single"
              selected={parsed}
              onSelect={(d) => {
                if (d) {
                  onChange(formatLocalYMD(d))
                  setOpen(false)
                }
              }}
              disabled={
                minDate || maxDate
                  ? { before: minDate ?? new Date(1970, 0, 1), after: maxDate ?? new Date(9999, 11, 31) }
                  : undefined
              }
              defaultMonth={parsed ?? minDate ?? new Date()}
              // Pink theming — selected day, today highlight, hover, range
              // chrome all overridden via inline CSS so we don't have to ship
              // a separate global stylesheet.
              styles={{
                root: { '--rdp-accent-color': '#E84A7A', '--rdp-accent-background-color': '#FFE4EC' } as React.CSSProperties,
              }}
              classNames={{
                day_button: 'hover:bg-pink-50 rounded-md',
                today: 'font-bold text-pink-600',
                selected: 'bg-pink-500 text-white hover:bg-pink-600 rounded-md',
                chevron: 'fill-pink-500',
                caption_label: 'font-semibold text-gray-900',
              }}
            />
            <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-xs">
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false) }}
                className="text-gray-500 hover:text-pink-600 font-medium"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => { onChange(formatLocalYMD(new Date())); setOpen(false) }}
                className="text-pink-600 hover:text-pink-700 font-medium"
              >
                Today
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Local-calendar YYYY-MM-DD without TZ drift (vs. .toISOString which UTC-shifts).
function formatLocalYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalYMD(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
