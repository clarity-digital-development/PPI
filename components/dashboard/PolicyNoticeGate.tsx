'use client'

import { useState } from 'react'
import type { PolicyNotice } from '@/lib/policy-notices'
import PolicyNoticeModal from './PolicyNoticeModal'

interface Props {
  notice: PolicyNotice
}

// WHY: server layout decides whether to render this at all (no flash, no markup
// for exempt users). This thin client wrapper just holds the "user accepted in
// this tab, hide it now" state so we don't need a full route refresh.
export default function PolicyNoticeGate({ notice }: Props) {
  const [visible, setVisible] = useState(true)
  if (!visible) return null
  return <PolicyNoticeModal notice={notice} onAccepted={() => setVisible(false)} />
}
