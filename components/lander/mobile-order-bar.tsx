'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Phones only: once the sign's buttons scroll away, keep them in thumb reach.
// A spacer at the end of the page (in the page component) stops the bar
// from covering the footer.
export function MobileOrderBar() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t-2 border-blush bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm transition-transform duration-300 md:hidden ${show ? 'translate-y-0' : 'translate-y-full'}`}
      aria-hidden={!show}
    >
      <div className="flex items-center gap-4">
        <Link href="/sign-up" className="ring-btn flex-1" tabIndex={show ? 0 : -1}>
          <span className="bg-pink-600 text-white">Get started</span>
        </Link>
        <Link href="/sign-in" className="px-2 py-3 font-bold text-raspberry underline decoration-2 underline-offset-4" tabIndex={show ? 0 : -1}>
          Sign in
        </Link>
      </div>
    </div>
  )
}
