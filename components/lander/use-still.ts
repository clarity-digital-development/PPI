'use client'

import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

// True when the visitor asks for reduced motion. Read after hydration: the
// server can't know the preference, so the first client render has to match
// the server's moving version, then switches.
export function useStill() {
  const reduced = useReducedMotion()
  const [still, setStill] = useState(false)
  useEffect(() => setStill(reduced === true), [reduced])
  return still
}
