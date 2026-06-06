'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PolicyNotice } from '@/lib/policy-notices'
import { cn } from '@/lib/utils'

interface Props {
  notice: PolicyNotice
  onAccepted: () => void
}

// WHY: standalone, intentionally non-dismissible — the shared Modal closes on
// backdrop click/X, which would defeat the legal-acceptance gate. See spec §4.
export default function PolicyNoticeModal({ notice, onAccepted }: Props) {
  const titleId = useId()
  const checkboxRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [accepted, setAccepted] = useState(false)
  const [openSectionId, setOpenSectionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // WHY: focus checkbox on mount so keyboard users can accept without tabbing through copy
  useEffect(() => {
    checkboxRef.current?.focus()
  }, [])

  // WHY: lock body scroll while modal is up so users can't escape behind it
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // WHY: trap focus inside the modal — required for screen-reader users so Tab
  // doesn't escape to the (visually hidden) dashboard behind the backdrop
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const focusables = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const toggleSection = useCallback((id: string) => {
    setOpenSectionId(prev => (prev === id ? null : id))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!accepted || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/profile/accept-notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: notice.version }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error ?? 'Unable to save your acceptance — please try again.')
      }
      onAccepted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }, [accepted, submitting, notice.version, onAccepted])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop — opaque, no onClick handler (non-dismissible) */}
      <div className="fixed inset-0 bg-black/70 animate-fade-in" aria-hidden="true" />

      {/* Card */}
      <div
        ref={containerRef}
        className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col animate-scale-in"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <h2 id={titleId} className="text-2xl font-semibold text-pink-600">
            {notice.modalTitle}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          <p className="text-gray-700 leading-relaxed">{notice.intro}</p>

          <div className="mt-5 space-y-3">
            {notice.sections.map(section => {
              const isOpen = openSectionId === section.id
              const panelId = `${section.id}-panel`
              const buttonId = `${section.id}-button`
              return (
                <div
                  key={section.id}
                  className="border border-pink-200 rounded-md overflow-hidden bg-pink-50/40"
                >
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggleSection(section.id)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-pink-700 font-medium hover:bg-pink-50 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-inset transition-colors"
                  >
                    <span>{section.title}</span>
                    <ChevronDown
                      className={cn(
                        'w-5 h-5 flex-shrink-0 transition-transform duration-200',
                        isOpen && 'rotate-180'
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  {isOpen && (
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      className="px-4 pb-4 pt-1 text-gray-700 leading-relaxed border-t border-pink-200/60 bg-white"
                    >
                      <p className="whitespace-pre-line">{section.body}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer — checkbox + CTA */}
        <div className="px-6 py-5 border-t border-gray-100 flex-shrink-0 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
              disabled={submitting}
              className="mt-1 h-5 w-5 rounded border-gray-300 text-pink-600 focus:ring-pink-500 cursor-pointer"
            />
            <span className="text-gray-800">{notice.checkboxLabel}</span>
          </label>

          {error && (
            <p
              role="alert"
              className="text-sm text-error bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!accepted || submitting}
            className={cn(
              'w-full inline-flex items-center justify-center font-medium rounded-md px-5 py-3 transition-all duration-300',
              'bg-pink-600 text-white shadow-md',
              'hover:bg-pink-700 hover:shadow-pink',
              'focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-pink-600 disabled:hover:shadow-md'
            )}
          >
            {submitting ? 'Saving…' : notice.ctaLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
