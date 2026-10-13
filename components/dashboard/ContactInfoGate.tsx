'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Phone, User } from 'lucide-react'
import { Input } from '@/components/ui'
import { cn } from '@/lib/utils'

interface Props {
  fullName: string
  phone: string
}

// Asks for a missing name or phone: some accounts came over from the October
// 2026 move without them, and the crew calls the agent from the dispatch
// sheet. The server layout only renders this when one is blank. "Not now"
// (or Escape) hides it until the next full page load, so it never blocks an
// order.
export default function ContactInfoGate({ fullName: initialName, phone: initialPhone }: Props) {
  const titleId = useId()
  const router = useRouter()
  const pathname = usePathname()
  const formRef = useRef<HTMLFormElement>(null)
  const [visible, setVisible] = useState(true)
  const [fullName, setFullName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same as PolicyNoticeModal: lock page scroll and keep keyboard focus in the
  // dialog (pages that autofocus their own fields, like Place Order's agent
  // search, would otherwise pull focus behind it). Escape = "Not now".
  useEffect(() => {
    if (!visible) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusables = () =>
      Array.from(
        formRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []
      )
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!submitting) setVisible(false)
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    function onFocusIn(e: FocusEvent) {
      if (formRef.current && !formRef.current.contains(e.target as Node)) focusables()[0]?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [visible, submitting])

  if (!visible) return null

  const missingName = !initialName.trim()
  const missingPhone = !initialPhone.trim()
  const missing = missingName && missingPhone ? 'name and phone number' : missingName ? 'name' : 'phone number'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!fullName.trim()) {
      setError('Please enter your name.')
      return
    }
    if (phone.replace(/\D/g, '').length < 10) {
      setError('Please enter a phone number with area code.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim() }),
      })
      if (!res.ok) throw new Error()
      // The profile page keeps its own copy of name/phone from when it loaded;
      // reload it so a later save there doesn't send the blanks back.
      if (pathname === '/dashboard/profile') {
        window.location.reload()
        return
      }
      setVisible(false)
      router.refresh()
    } catch {
      setError("We couldn't save that. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="fixed inset-0 bg-black/60 animate-fade-in" aria-hidden="true" />
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative bg-white rounded-lg shadow-xl max-w-md w-full max-h-full overflow-y-auto animate-scale-in"
      >
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 id={titleId} className="text-xl font-semibold text-pink-600">
            Finish setting up your account
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            We don&apos;t have your {missing} on file yet. Our crew uses your contact info to reach you about your
            posts.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <Input
            label="Full Name"
            icon={<User className="w-5 h-5" />}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            disabled={submitting}
            autoFocus={missingName}
          />
          <Input
            label="Phone Number"
            type="tel"
            icon={<Phone className="w-5 h-5" />}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 555-5555"
            autoComplete="tel"
            disabled={submitting}
            autoFocus={!missingName}
          />
          {error && (
            <p role="alert" className="text-sm text-error bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={() => setVisible(false)}
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-md px-5 py-3 font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2"
          >
            Not now
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={cn(
              'inline-flex items-center justify-center font-medium rounded-md px-5 py-3 transition-all duration-300',
              'bg-pink-600 text-white shadow-md',
              'hover:bg-pink-700 hover:shadow-pink',
              'focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
