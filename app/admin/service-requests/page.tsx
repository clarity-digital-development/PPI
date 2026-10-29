'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  Card,
  CardContent,
  Badge,
  Button,
  Select,
  Modal,
  Input,
} from '@/components/ui'
import {
  Wrench,
  Calendar,
  MapPin,
  User,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Eye,
  DollarSign,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { DateInput } from '@/components/ui/DateInput'
import { useDispatchSelection } from '@/components/admin/dispatch/useDispatchSelection'
import { DispatchBar } from '@/components/admin/dispatch/DispatchBar'
import { DispatchEmailModal } from '@/components/admin/dispatch/DispatchEmailModal'

// Match the orders admin list page size — Ryan asked for the SR list to
// paginate "like orders" (2026-07-06) so he can find old service requests
// past the historical first-50 cap.
const PAGE_SIZE = 25

interface ServiceRequest {
  id: string
  type: string
  status: string
  description: string | null
  notes: string | null
  adminNotes: string | null
  requestedDate: string | null
  completedAt: string | null
  createdAt: string
  invoiceAmount: number | string | null
  invoiceStatus: 'paid' | 'pending_invoice' | 'failed' | null
  invoicePaidAt: string | null
  user: {
    id: string
    email: string
    fullName: string | null
    phone: string | null
    company: string | null
    // Pay-on-invoice flag — when true the Invoice action defers to the
    // next bundled invoice instead of charging the card on file.
    invoiceBilling: boolean
  }
  installation: {
    id: string
    propertyAddress: string
    propertyCity: string
    propertyState: string
    propertyZip: string
    status: string
    order?: {
      id: string
      orderNumber: string
      status?: string
      placedForAgentName?: string | null
      // Out-of-area pickup half (see ooaPickupOf below).
      serviceAreaSecondChargeCents?: number | null
      serviceAreaSecondChargeStatus?: 'pending' | 'paid' | 'failed' | 'pending_invoice' | null
      serviceAreaSecondChargeInvoiceId?: string | null
      ooaPickupInvoice?: { invoiceNumber: string; status: 'sent' | 'paid' | 'void' } | null
      orderItems: Array<{ description: string; quantity: number; itemType: string }>
    }
  } | null
  // For unlisted-address service requests (no existing installation)
  unlistedAddress?: string | null
  unlistedCity?: string | null
  unlistedState?: string | null
  unlistedZip?: string | null
}

interface Counts {
  pending: number
  acknowledged: number
  scheduled: number
  in_progress: number
  completed: number
  cancelled: number
  // Count of SRs with invoiceStatus='pending_invoice' — orthogonal to
  // workflow status (an SR can be 'completed' AND 'pending_invoice').
  pending_invoice: number
  total: number
}

const statusConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'neutral' | 'info'; color: string }> = {
  pending: { label: 'Pending', variant: 'warning', color: 'bg-amber-100 text-amber-800' },
  acknowledged: { label: 'Acknowledged', variant: 'info', color: 'bg-blue-100 text-blue-800' },
  scheduled: { label: 'Scheduled', variant: 'info', color: 'bg-indigo-100 text-indigo-800' },
  in_progress: { label: 'In Progress', variant: 'info', color: 'bg-purple-100 text-purple-800' },
  completed: { label: 'Completed', variant: 'success', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelled', variant: 'neutral', color: 'bg-gray-100 text-gray-800' },
}

const typeConfig: Record<string, { label: string; icon: typeof Wrench }> = {
  removal: { label: 'Removal', icon: XCircle },
  service: { label: 'Service', icon: Wrench },
  repair: { label: 'Repair', icon: Wrench },
  replacement: { label: 'Replacement', icon: Wrench },
}

// Out-of-area pickup half on a removal's order (Ryan, 2026-09-28: "pending
// out of area pickup" visibility). Scheduling the removal collects it on its
// own — card payers are charged, invoice payers get it queued as its own line
// on their next invoice (lib/orders/out-of-area-charge.ts) — so the removal
// request shows where it stands, and the Invoice action warns before the
// same trip is billed again by hand.
type OOAPickupState = 'pending' | 'queued' | 'on_invoice' | 'paid_invoice' | 'paid_card' | 'failed' | 'not_owed'

interface OOAPickup {
  state: OOAPickupState
  cents: number
  orderId: string
  orderNumber: string
  invoiceNumber: string | null
  // Mirrors the double-billing guard in
  // app/api/admin/service-requests/[id]/invoice/route.ts: queued, on an
  // invoice, or paid. 'pending' isn't collected yet; 'failed' never was.
  alreadyBilled: boolean
}

function ooaPickupOf(request: ServiceRequest): OOAPickup | null {
  if (request.type !== 'removal') return null
  const o = request.installation?.order
  const status = o?.serviceAreaSecondChargeStatus
  const cents = o?.serviceAreaSecondChargeCents ?? 0
  if (!o || !status || cents <= 0) return null
  const invoiceNumber = o.ooaPickupInvoice?.invoiceNumber ?? null
  // A cancelled (or refunded) order owes no pickup fee — nothing charges or
  // bundles it — unless the half already sits on an invoice.
  const notOwed =
    o.status === 'cancelled' && !o.serviceAreaSecondChargeInvoiceId && status !== 'paid'
  const state: OOAPickupState = notOwed
    ? 'not_owed'
    : status === 'pending_invoice'
      ? invoiceNumber ? 'on_invoice' : 'queued'
      : status === 'paid'
        ? invoiceNumber ? 'paid_invoice' : 'paid_card'
        : status
  return {
    state,
    cents,
    orderId: o.id,
    orderNumber: o.orderNumber,
    invoiceNumber,
    alreadyBilled: !notOwed && (status === 'pending_invoice' || status === 'paid' || !!o.serviceAreaSecondChargeInvoiceId),
  }
}

function ooaPickupLabel(p: OOAPickup): string {
  switch (p.state) {
    case 'queued': return 'Queued for next invoice'
    case 'on_invoice': return `On invoice ${p.invoiceNumber}`
    case 'paid_invoice': return `Paid on invoice ${p.invoiceNumber}`
    case 'paid_card': return 'Charged to card'
    case 'failed': return 'Charge failed — retry on the order page'
    case 'pending': return 'Collected when removal is scheduled'
    case 'not_owed': return 'Not collected — order cancelled'
  }
}

const ooaPickupBadgeVariant: Record<OOAPickupState, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending: 'neutral',
  queued: 'info',
  on_invoice: 'info',
  paid_invoice: 'success',
  paid_card: 'success',
  failed: 'error',
  not_owed: 'neutral',
}

// "is already on invoice INV-…" / "was already charged to their card" — the
// tail of the Invoice action's warning + confirm, matching the route's 409.
function ooaPickupAlreadyWhere(p: OOAPickup): string {
  switch (p.state) {
    case 'paid_invoice': return `was already paid on invoice ${p.invoiceNumber}`
    case 'paid_card': return 'was already charged to their card automatically'
    case 'on_invoice': return `is already on invoice ${p.invoiceNumber}`
    default: return 'is already added to their next invoice automatically'
  }
}

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`

// The status PUT returns a slimmer user/installation than the list GET (no
// invoiceBilling, phone, company, or order). A plain spread swapped those in
// wholesale, which silently killed the completed-without-amount nudge
// (user.invoiceBilling read as undefined) and would blank the out-of-area
// pickup panel on a modal kept open. Merge the nested objects instead.
function mergeServiceRequest(prev: ServiceRequest, patch: Partial<ServiceRequest>): ServiceRequest {
  return {
    ...prev,
    ...patch,
    user: { ...prev.user, ...(patch.user ?? {}) },
    installation: prev.installation
      ? { ...prev.installation, ...(patch.installation ?? {}) }
      : (patch.installation ?? null),
  }
}

const typeFilterOptions = [
  { value: '', label: 'All Types' },
  { value: 'removal', label: 'Removal' },
  { value: 'service', label: 'Service' },
  { value: 'repair', label: 'Repair' },
  { value: 'replacement', label: 'Replacement' },
]

export default function ServiceRequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  // Separate filter for invoiceStatus — orthogonal to workflow status.
  // Drives the "Pending invoice" tile so admin can click it to scope the
  // list to just the SRs queued for the next bundled invoice.
  const [filterInvoiceStatus, setFilterInvoiceStatus] = useState<string>('')
  // Installer dispatch: requested-day filter ('' | 'unscheduled' | YYYY-MM-DD)
  // plus the cross-page selection shared with /admin/orders.
  const [filterDate, setFilterDate] = useState<string>('')
  const selection = useDispatchSelection()
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [adminNotes, setAdminNotes] = useState('')
  // Notes save on their own (they used to ride along only with a status
  // button) and print on the crew's dispatch email.
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesMessage, setNotesMessage] = useState<string | null>(null)
  // Which request the popup shows, so a save that lands after a close/reopen
  // only updates the popup it belongs to.
  const openRequestIdRef = useRef<string | null>(null)
  const [scheduledDate, setScheduledDate] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoicing, setInvoicing] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  // Auto-prompt state — set when admin marks an invoice-billing SR as
  // completed without a billing amount yet. Keeps the modal open, scrolls
  // the amount input into view, focuses it, and renders a yellow nudge
  // banner so admin doesn't accidentally leave the SR completed-but-unbilled.
  const [needsInvoiceAmount, setNeedsInvoiceAmount] = useState(false)
  const invoiceAmountInputRef = useRef<HTMLInputElement>(null)

  // When the auto-prompt fires, focus + scroll the amount input on the
  // next render so the user sees + can type into it immediately.
  useEffect(() => {
    if (needsInvoiceAmount && invoiceAmountInputRef.current) {
      invoiceAmountInputRef.current.focus()
      invoiceAmountInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [needsInvoiceAmount])

  // Filter changes reset the page cursor — otherwise flipping from
  // Completed (page 3) to Pending would try to open Pending's page 3 which
  // may not exist, and the client-side page state would show empty despite
  // matching records existing on page 0.
  useEffect(() => {
    setPage(0)
  }, [filterStatus, filterType, filterInvoiceStatus, filterDate])

  useEffect(() => {
    fetchRequests()
    // fetchRequests is defined at component scope and closes over the same
    // deps — safe to omit from the array. Adding it triggers a fresh
    // reference every render, which loops. Matches the pre-existing pattern
    // used elsewhere in this file for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterType, filterInvoiceStatus, filterDate, page])

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterType) params.set('type', filterType)
      if (filterInvoiceStatus) params.set('invoiceStatus', filterInvoiceStatus)
      if (filterDate) params.set('requested_date', filterDate)
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(page * PAGE_SIZE))

      const res = await fetch(`/api/admin/service-requests?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setRequests(data.serviceRequests)
        setCounts(data.counts)
        setTotal(typeof data.total === 'number' ? data.total : (data.serviceRequests?.length ?? 0))
      }
    } catch (error) {
      console.error('Error fetching service requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleViewRequest = (request: ServiceRequest) => {
    setSelectedRequest(request)
    openRequestIdRef.current = request.id
    setAdminNotes(request.adminNotes || '')
    setNotesMessage(null)
    setScheduledDate(request.requestedDate ? request.requestedDate.split('T')[0] : '')
    setInvoiceAmount(request.invoiceAmount != null ? String(request.invoiceAmount) : '')
    setInvoiceError(null)
    setNeedsInvoiceAmount(false)
    setShowModal(true)
  }

  // Take a charge that's waiting for the next invoice back off (Ryan,
  // 2026-10-28: an amount can't be set to $0).
  const [removingCharge, setRemovingCharge] = useState(false)
  const handleRemoveCharge = async () => {
    if (!selectedRequest || removingCharge) return
    const amt = Number(selectedRequest.invoiceAmount ?? 0)
    if (!window.confirm(`Take the $${amt.toFixed(2)} charge off this customer's next invoice?`)) return
    const srId = selectedRequest.id
    setRemovingCharge(true)
    setInvoiceError(null)
    try {
      const res = await fetch(`/api/admin/service-requests/${srId}/invoice`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.serviceRequest) throw new Error(data.error || "Couldn't remove the charge.")
      setRequests((prev) => prev.map((r) => (r.id === srId ? mergeServiceRequest(r, data.serviceRequest) : r)))
      setSelectedRequest((prev) => (prev && prev.id === srId ? mergeServiceRequest(prev, data.serviceRequest) : prev))
      setInvoiceAmount('')
      fetchRequests() // refresh counts
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : "Couldn't remove the charge.")
    } finally {
      setRemovingCharge(false)
    }
  }

  // Closing on a completed trip that still has no charge asks first, so a
  // trip isn't left unbilled by accident (Ryan, 2026-10-28).
  const closeModal = () => {
    if (needsInvoiceAmount && !window.confirm('This trip is complete but has no charge. Close without adding one?')) return
    setShowModal(false)
    setNeedsInvoiceAmount(false)
  }

  const handleSendInvoice = async () => {
    if (!selectedRequest) return
    const amt = Number(invoiceAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setInvoiceError('Enter a valid amount greater than $0.')
      return
    }
    // Removal whose out-of-area pickup is already queued / billed / charged:
    // the route refuses (409) unless allow_extra is sent, and we only send it
    // once the admin confirms this is a genuinely separate charge.
    const pickup = ooaPickupOf(selectedRequest)
    let allowExtra = false
    if (pickup?.alreadyBilled) {
      const ok = window.confirm(
        `The out-of-area pickup (${formatCents(pickup.cents)}) for this removal ${ooaPickupAlreadyWhere(pickup)}.\n\n` +
          `Only add $${amt.toFixed(2)} here if it's a separate charge. Add it anyway?`
      )
      if (!ok) return
      allowExtra = true
    }
    const srId = selectedRequest.id
    const postInvoice = (extra: boolean) =>
      fetch(`/api/admin/service-requests/${srId}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, ...(extra ? { allow_extra: true } : {}) }),
      })
    setInvoicing(true)
    setInvoiceError(null)
    try {
      let res = await postInvoice(allowExtra)
      let data = await res.json()
      // This list was loaded before the pickup got queued/charged — the
      // route caught it. Same confirm, then resend.
      if (res.status === 409 && data.code === 'ooa_pickup_already_billed' && !allowExtra) {
        if (!window.confirm(`${data.error}\n\nAdd $${amt.toFixed(2)} anyway?`)) return
        res = await postInvoice(true)
        data = await res.json()
      }
      if (!res.ok) {
        throw new Error(data.error || 'Charge failed')
      }
      // Merge the updated invoice fields into both the list and the open modal
      setRequests((prev) =>
        prev.map((r) => (r.id === srId ? mergeServiceRequest(r, data.serviceRequest) : r))
      )
      setSelectedRequest((prev) => (prev ? mergeServiceRequest(prev, data.serviceRequest) : prev))
      // Auto-prompt fulfilled — clear the nudge so the yellow banner goes
      // away and the "pending_invoice" / "paid" success banner takes over.
      setNeedsInvoiceAmount(false)
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : 'Charge failed')
    } finally {
      setInvoicing(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!selectedRequest || savingNotes) return
    const srId = selectedRequest.id
    const text = adminNotes
    setSavingNotes(true)
    setNotesMessage(null)
    try {
      const res = await fetch(`/api/admin/service-requests/${srId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_notes: text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.serviceRequest) throw new Error(data.error || 'Save failed')
      setRequests((prev) => prev.map((r) => (r.id === srId ? mergeServiceRequest(r, data.serviceRequest) : r)))
      setSelectedRequest((prev) => (prev && prev.id === srId ? mergeServiceRequest(prev, data.serviceRequest) : prev))
      if (openRequestIdRef.current === srId) {
        // A close/reopen mid-save loaded the old list row; the box was locked,
        // so nothing typed since is lost.
        setAdminNotes(data.serviceRequest.adminNotes ?? text)
        setNotesMessage('Saved')
      }
    } catch {
      if (openRequestIdRef.current === srId) setNotesMessage("Couldn't save. Please try again.")
    } finally {
      setSavingNotes(false)
    }
  }

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedRequest) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/admin/service-requests/${selectedRequest.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          admin_notes: adminNotes,
          scheduled_date: scheduledDate || null,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        // This also saved the notes, so an earlier notes error is out of date.
        setNotesMessage(null)
        const updated = mergeServiceRequest(selectedRequest, data.serviceRequest)
        setRequests((prev) =>
          prev.map((r) => (r.id === selectedRequest.id ? mergeServiceRequest(r, data.serviceRequest) : r))
        )

        // Auto-prompt: if admin just marked a service trip completed and no
        // charge is set yet, keep the modal open + nudge them to enter one
        // instead of closing and leaving the trip completed-but-unbilled.
        // Every customer, not only invoice accounts: card customers' trips
        // were being left uncharged too (Ryan, 2026-10-28). Effect hook
        // above handles the focus + scroll once needsInvoiceAmount flips true.
        // Removals are skipped: the pickup is paid through the order (and its
        // out-of-area half collects itself), so nudging for an amount there
        // invites billing the trip twice. That includes unlisted-address
        // removals, which since the Oct 2026 rebuild are often one of our
        // own signs whose record is missing; a real trip fee can still be
        // entered by hand.
        const shouldPrompt =
          newStatus === 'completed' &&
          updated.type !== 'removal' &&
          (updated.invoiceAmount == null || Number(updated.invoiceAmount) <= 0) &&
          updated.invoiceStatus !== 'paid' &&
          updated.invoiceStatus !== 'pending_invoice'

        if (shouldPrompt) {
          setSelectedRequest(updated)
          setNeedsInvoiceAmount(true)
          fetchRequests() // refresh counts in the background
        } else {
          setShowModal(false)
          fetchRequests() // Refresh counts
        }
      }
    } catch (error) {
      console.error('Error updating service request:', error)
    } finally {
      setUpdating(false)
    }
  }

  const getFullAddress = (request: ServiceRequest) => {
    if (request.installation) {
      const i = request.installation
      return `${i.propertyAddress}, ${i.propertyCity}, ${i.propertyState} ${i.propertyZip}`
    }
    if (request.unlistedAddress) {
      // A removal of a sign that isn't on the customer's list is often one of
      // ours whose record is missing (the "isn't listed" option on Schedule
      // Removal), and its pickup was paid with the install, so don't presume a fee.
      const note = request.type === 'removal'
        ? 'not on their list, may be one of ours'
        : 'unlisted — trip fee applies'
      return `${request.unlistedAddress}, ${request.unlistedCity}, ${request.unlistedState} ${request.unlistedZip} (${note})`
    }
    return '(no address)'
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Service Requests</h1>
        <p className="text-gray-600">Manage customer service and removal requests</p>
      </div>

      {/* Status Cards — workflow status (pending → completed) on top row,
          Pending invoice tile is orthogonal (an SR can be Completed AND
          Pending invoice). Clicking a workflow tile clears the invoice
          filter and vice versa so the two filter dimensions don't fight. */}
      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'pending' && !filterInvoiceStatus ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => { setFilterInvoiceStatus(''); setFilterStatus(filterStatus === 'pending' ? '' : 'pending') }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{counts.pending}</p>
              <p className="text-sm text-gray-600">Pending</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'acknowledged' && !filterInvoiceStatus ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => { setFilterInvoiceStatus(''); setFilterStatus(filterStatus === 'acknowledged' ? '' : 'acknowledged') }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{counts.acknowledged}</p>
              <p className="text-sm text-gray-600">Acknowledged</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'scheduled' && !filterInvoiceStatus ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => { setFilterInvoiceStatus(''); setFilterStatus(filterStatus === 'scheduled' ? '' : 'scheduled') }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{counts.scheduled}</p>
              <p className="text-sm text-gray-600">Scheduled</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'in_progress' && !filterInvoiceStatus ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => { setFilterInvoiceStatus(''); setFilterStatus(filterStatus === 'in_progress' ? '' : 'in_progress') }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{counts.in_progress}</p>
              <p className="text-sm text-gray-600">In Progress</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'completed' && !filterInvoiceStatus ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => { setFilterInvoiceStatus(''); setFilterStatus(filterStatus === 'completed' ? '' : 'completed') }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{counts.completed}</p>
              <p className="text-sm text-gray-600">Completed</p>
            </CardContent>
          </Card>
          {/* Pending invoice — queue of SRs with an amount set and waiting
              for the next bundled invoice. Pink-highlighted because it's
              the action queue Ryan needs to watch. */}
          <Card
            className={`cursor-pointer transition-all ${filterInvoiceStatus === 'pending_invoice' ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => { setFilterStatus(''); setFilterInvoiceStatus(filterInvoiceStatus === 'pending_invoice' ? '' : 'pending_invoice') }}
            title="SRs queued for the next bundled invoice"
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-pink-600">{counts.pending_invoice ?? 0}</p>
              <p className="text-sm text-gray-600">Pending invoice</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === '' && !filterInvoiceStatus ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => { setFilterStatus(''); setFilterInvoiceStatus('') }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{counts.pending + counts.acknowledged + counts.scheduled + counts.in_progress}</p>
              <p className="text-sm text-gray-600">Active</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="w-48">
              <Select
                label="Type"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                options={typeFilterOptions}
                placeholder="All Types"
              />
            </div>
            {/* Requested-day filter for the dispatch workflow — mirrors the
                install-date filter on /admin/orders. */}
            <div className="w-44">
              <DateInput
                label="Requested date"
                value={filterDate === 'unscheduled' ? '' : filterDate}
                // Clear fires '' even when the field was already empty
                // (Unscheduled active) — keep that filter.
                onChange={(v) => { if (!v && filterDate === 'unscheduled') return; setFilterDate(v) }}
                placeholder="Any date"
              />
            </div>
            <Button
              variant={filterDate === 'unscheduled' ? 'primary' : 'outline'}
              className="self-end"
              onClick={() => setFilterDate((d) => (d === 'unscheduled' ? '' : 'unscheduled'))}
              title="Show only requests with no date picked yet"
            >
              {filterDate === 'unscheduled' ? 'Unscheduled · clear' : 'Unscheduled'}
            </Button>
            {(filterStatus || filterType || filterDate) && (
              <Button
                variant="outline"
                className="self-end"
                onClick={() => {
                  setFilterStatus('')
                  setFilterType('')
                  setFilterDate('')
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Requests List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No service requests found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <Card key={request.id} className={`hover:shadow-md transition-shadow ${selection.isServiceRequestSelected(request.id) ? 'ring-1 ring-pink-200 bg-pink-50/40' : ''}`}>
              <CardContent className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <input
                        type="checkbox"
                        aria-label="Select this service request for the installer email"
                        checked={selection.isServiceRequestSelected(request.id)}
                        onChange={() => selection.toggleServiceRequest(request.id)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={request.status === 'cancelled'}
                        title={request.status === 'cancelled' ? "Cancelled requests aren't dispatched" : undefined}
                        className="w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500 disabled:opacity-40"
                      />
                      <Badge variant={statusConfig[request.status]?.variant || 'neutral'}>
                        {statusConfig[request.status]?.label || request.status}
                      </Badge>
                      {/* Invoice-status badge — surfaces 'pending_invoice' so
                          admin can scan the list for what's queued for the
                          next bundle without opening each modal. */}
                      {request.invoiceStatus === 'pending_invoice' && (
                        <Badge variant="info">
                          Pending invoice ${Number(request.invoiceAmount ?? 0).toFixed(2)}
                        </Badge>
                      )}
                      {request.invoiceStatus === 'paid' && (
                        <Badge variant="success">
                          Paid ${Number(request.invoiceAmount ?? 0).toFixed(2)}
                        </Badge>
                      )}
                      {request.invoiceStatus === 'failed' && (
                        <Badge variant="warning">Charge failed</Badge>
                      )}
                      {/* Out-of-area pickup half on a removal — its state is
                          in the hover title and the request modal. */}
                      {(() => {
                        const pickup = ooaPickupOf(request)
                        return pickup ? (
                          <Badge variant={ooaPickupBadgeVariant[pickup.state]} title={ooaPickupLabel(pickup)}>
                            OOA pickup {formatCents(pickup.cents)}
                          </Badge>
                        ) : null
                      })()}
                      <span className="text-sm font-medium text-gray-900 capitalize">
                        {typeConfig[request.type]?.label || request.type}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatDate(request.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-start gap-2 text-sm text-gray-600 mb-2">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{getFullAddress(request)}</span>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <User className="w-4 h-4 flex-shrink-0" />
                      <span>
                        {request.user.fullName || request.user.email}
                        {request.user.company && ` - ${request.user.company}`}
                      </span>
                    </div>

                    {request.installation?.order?.placedForAgentName && (
                      <div className="flex items-center gap-2 text-sm text-pink-700 mt-1">
                        <User className="w-4 h-4 flex-shrink-0" />
                        <span>Agent: {request.installation.order.placedForAgentName}</span>
                      </div>
                    )}

                    {request.description && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                        {request.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {request.requestedDate && (
                      <div className="flex items-center gap-1 text-sm text-gray-500 mr-4">
                        <Calendar className="w-4 h-4" />
                        <span>{formatDate(request.requestedDate)}</span>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => handleViewRequest(request)}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination — mirrors the orders admin list. Shown whenever any
          filtered result exists so admin can page through history past the
          first 25 records (fixes the "list ends 6/19 with 113 completed"
          truncation Ryan reported 2026-07-06). */}
      {!loading && total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
          <p className="text-sm text-gray-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} service requests
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(Math.max(0, page - 1))}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <span className="text-sm text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(page + 1)}
              className="gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Service Request Details"
      >
        {selectedRequest && (
          <div className="space-y-6">
            {/* Status & Type */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={statusConfig[selectedRequest.status]?.variant || 'neutral'}>
                {statusConfig[selectedRequest.status]?.label || selectedRequest.status}
              </Badge>
              {selectedRequest.invoiceStatus === 'pending_invoice' && (
                <Badge variant="info">
                  Pending invoice ${Number(selectedRequest.invoiceAmount ?? 0).toFixed(2)}
                </Badge>
              )}
              {selectedRequest.invoiceStatus === 'paid' && (
                <Badge variant="success">
                  Paid ${Number(selectedRequest.invoiceAmount ?? 0).toFixed(2)}
                </Badge>
              )}
              {selectedRequest.invoiceStatus === 'failed' && (
                <Badge variant="warning">Charge failed</Badge>
              )}
              <span className="font-medium capitalize">
                {typeConfig[selectedRequest.type]?.label || selectedRequest.type}
              </span>
            </div>

            {/* Customer Info */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">Customer</h4>
              <div className="space-y-1 text-sm">
                <p className="text-gray-700">{selectedRequest.user.fullName || 'No name provided'}</p>
                <p className="text-gray-600">{selectedRequest.user.email}</p>
                {selectedRequest.user.phone && (
                  <p className="text-gray-600">{selectedRequest.user.phone}</p>
                )}
                {selectedRequest.user.company && (
                  <p className="text-gray-500">{selectedRequest.user.company}</p>
                )}
                {selectedRequest.installation?.order?.placedForAgentName && (
                  <p className="text-pink-700 font-medium pt-1">
                    Agent: {selectedRequest.installation.order.placedForAgentName}
                  </p>
                )}
              </div>
            </div>

            {/* Installation Address */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">Installation</h4>
              <p className="text-sm text-gray-700">{getFullAddress(selectedRequest)}</p>
            </div>

            {/* Request Details */}
            {selectedRequest.description && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                <p className="text-sm text-gray-600">{selectedRequest.description}</p>
              </div>
            )}

            {selectedRequest.notes && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Customer Notes</h4>
                {/* pre-line: removal SRs put the lockbox answer on its own line */}
                <p className="text-sm text-gray-600 whitespace-pre-line">{selectedRequest.notes}</p>
              </div>
            )}

            {/* For removal requests, show what was originally installed so admin
                knows what to bring back */}
            {selectedRequest.type === 'removal' && selectedRequest.installation?.order?.orderItems && selectedRequest.installation.order.orderItems.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h4 className="font-medium text-amber-900 mb-2">
                  Items Installed Here ({selectedRequest.installation.order.orderNumber})
                </h4>
                <ul className="text-sm text-amber-800 space-y-1">
                  {selectedRequest.installation.order.orderItems.map((item, idx) => (
                    <li key={idx} className="flex justify-between gap-2">
                      <span>{item.description}</span>
                      {item.quantity > 1 && (
                        <span className="text-amber-700 font-medium">×{item.quantity}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Out-of-area pickup — the second half of the order's
                out-of-area fee, collected on its own when this removal was
                scheduled (Ryan, 2026-09-28: "pending out of area pickup"). */}
            {(() => {
              const pickup = ooaPickupOf(selectedRequest)
              if (!pickup) return null
              return (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium text-gray-900 mb-2">Out-of-area pickup</h4>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <Badge variant={ooaPickupBadgeVariant[pickup.state]}>
                      {pickup.state === 'failed' ? 'Charge failed' : ooaPickupLabel(pickup)}
                    </Badge>
                    <span className="font-medium text-gray-900">{formatCents(pickup.cents)}</span>
                  </div>
                  {pickup.state === 'failed' && (
                    <p className="mt-2 text-sm text-red-700">
                      Charge failed —{' '}
                      <Link href={`/admin/orders/${pickup.orderId}`} className="underline font-medium">
                        retry on the order page
                      </Link>
                    </p>
                  )}
                  {pickup.state === 'queued' && (
                    <p className="mt-2 text-xs text-gray-500">
                      Added as its own line when this customer&apos;s next invoice is bundled.{' '}
                      <Link href="/admin/invoices" className="underline">Bundle &amp; send invoices →</Link>
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    Order{' '}
                    <Link href={`/admin/orders/${pickup.orderId}`} className="underline">
                      {pickup.orderNumber}
                    </Link>
                  </p>
                </div>
              )
            })()}

            {/* Admin Actions */}
            <div className="border-t pt-4">
              {/* Direct status control — set any status without stepping through
                  the workflow buttons below */}
              <div className="mb-4">
                <Select
                  label="Status"
                  value={selectedRequest.status}
                  onChange={(e) => handleUpdateStatus(e.target.value)}
                  options={[
                    { value: 'pending', label: 'Pending' },
                    { value: 'acknowledged', label: 'Acknowledged' },
                    { value: 'scheduled', label: 'Scheduled' },
                    { value: 'in_progress', label: 'In Progress' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ]}
                  disabled={updating}
                />
              </div>

              <Input
                type="date"
                label="Scheduled Date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                icon={<Calendar className="w-5 h-5" />}
              />

              <div className="mt-4">
                <label htmlFor="sr-admin-notes" className="block text-sm font-medium text-gray-700 mb-1">
                  Notes for the crew
                </label>
                <textarea
                  id="sr-admin-notes"
                  value={adminNotes}
                  disabled={savingNotes}
                  onChange={(e) => {
                    setAdminNotes(e.target.value)
                    setNotesMessage(null)
                  }}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all resize-none"
                  rows={3}
                  placeholder="Codes, what to pick up, where it goes..."
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    Prints on the installer&apos;s dispatch email. The customer doesn&apos;t see these.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    {notesMessage && (
                      <span className={notesMessage === 'Saved' ? 'text-xs text-green-600' : 'text-xs text-red-600'}>
                        {notesMessage}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveNotes}
                      disabled={savingNotes || adminNotes === (selectedRequest.adminNotes || '')}
                    >
                      {savingNotes ? 'Saving…' : 'Save notes'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Invoice — billing flow branches on the customer's
                invoiceBilling flag. Pay-on-invoice customers get the amount
                added to their next bundled invoice (no card touched);
                everyone else gets charged off-session against their default
                card. Backend already does this routing — the UI just has to
                read selectedRequest.user.invoiceBilling and adapt copy. */}
            {(() => {
              const isInvoiceBilling = !!selectedRequest.user.invoiceBilling
              const amt = Number(selectedRequest.invoiceAmount ?? 0)
              const pickup = ooaPickupOf(selectedRequest)
              // Removal whose out-of-area pickup already went on an invoice /
              // was charged by itself — warn before the same trip is billed
              // twice. handleSendInvoice confirms and sends allow_extra.
              const pickupWarning =
                pickup?.alreadyBilled && selectedRequest.invoiceStatus !== 'paid' ? (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <p>
                      The out-of-area pickup (<strong>{formatCents(pickup.cents)}</strong>) {ooaPickupAlreadyWhere(pickup)}.
                      Only add an amount here for a genuinely separate charge.
                    </p>
                  </div>
                ) : null
              return (
            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-gray-500" />
                Invoice
                {isInvoiceBilling && (
                  <span className="ml-1 text-xs font-normal text-pink-600 bg-pink-50 border border-pink-200 rounded px-1.5 py-0.5">
                    Pay-on-invoice
                  </span>
                )}
              </h4>
              {selectedRequest.invoiceStatus === 'paid' ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                  Charged ${amt.toFixed(2)} to the customer&apos;s card on file
                  {selectedRequest.invoicePaidAt ? ` on ${formatDate(selectedRequest.invoicePaidAt)}` : ''}.
                </div>
              ) : selectedRequest.invoiceStatus === 'pending_invoice' ? (
                <div className="space-y-2">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                    Added <strong>${amt.toFixed(2)}</strong> to this customer&apos;s next bundled invoice. No card has been charged.
                    {' '}<Link href="/admin/invoices" className="underline font-medium">Bundle &amp; send invoices →</Link>
                  </div>
                  <p className="text-xs text-gray-500">
                    Need to change it before bundling? Enter a new amount and click Update amount, or Remove charge to take it off.
                  </p>
                  {pickupWarning}
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        type="number"
                        label="Update amount (USD)"
                        value={invoiceAmount}
                        onChange={(e) => setInvoiceAmount(e.target.value)}
                        placeholder="0.00"
                        icon={<DollarSign className="w-5 h-5" />}
                      />
                    </div>
                    <Button onClick={handleSendInvoice} disabled={invoicing || removingCharge || !invoiceAmount || Number(invoiceAmount) <= 0}>
                      {invoicing ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating…</>
                      ) : (
                        'Update amount'
                      )}
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveCharge}
                    disabled={removingCharge || invoicing}
                    className="text-sm text-red-600 hover:text-red-700 underline disabled:opacity-50"
                  >
                    {removingCharge ? 'Removing…' : 'Remove charge'}
                  </button>
                  {invoiceError && <p className="text-sm text-red-600">{invoiceError}</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Auto-prompt nudge — fires once when admin marks a
                      service trip 'completed' without a charge, so they
                      don't leave the modal with it completed-but-unbilled.
                      Clears when an amount submits or they pick No charge. */}
                  {needsInvoiceAmount && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium">Add a charge for this trip?</p>
                        <p className="text-xs mt-0.5">
                          This trip is marked complete. Enter the amount below to{' '}
                          {isInvoiceBilling ? 'add it to their next invoice' : 'charge their card on file'}, or click No charge if it&apos;s free.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNeedsInvoiceAmount(false)}
                        className="text-amber-700 hover:text-amber-900 text-xs underline whitespace-nowrap"
                      >
                        No charge
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-gray-500">
                    {isInvoiceBilling
                      ? 'This customer pays by invoice. The amount will be added to their next bundled invoice — no card will be charged now.'
                      : 'Enter the amount to charge the customer’s saved default card. They’ll be charged immediately.'}
                  </p>
                  {pickupWarning}
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        ref={invoiceAmountInputRef}
                        type="number"
                        label="Amount (USD)"
                        value={invoiceAmount}
                        onChange={(e) => setInvoiceAmount(e.target.value)}
                        placeholder="0.00"
                        icon={<DollarSign className="w-5 h-5" />}
                      />
                    </div>
                    <Button onClick={handleSendInvoice} disabled={invoicing || !invoiceAmount || Number(invoiceAmount) <= 0}>
                      {invoicing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {isInvoiceBilling ? 'Adding…' : 'Charging…'}
                        </>
                      ) : isInvoiceBilling ? (
                        invoiceAmount && Number(invoiceAmount) > 0
                          ? `Add $${Number(invoiceAmount).toFixed(2)} to invoice`
                          : 'Add to invoice'
                      ) : (
                        'Charge card on file'
                      )}
                    </Button>
                  </div>
                  {selectedRequest.invoiceStatus === 'failed' && !invoiceError && (
                    <p className="text-sm text-amber-600">
                      A previous charge attempt failed. You can try again.
                    </p>
                  )}
                  {invoiceError && <p className="text-sm text-red-600">{invoiceError}</p>}
                </div>
              )}
            </div>
              )
            })()}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-4 border-t">
              {selectedRequest.status === 'pending' && (
                <Button
                  variant="outline"
                  onClick={() => handleUpdateStatus('acknowledged')}
                  disabled={updating}
                >
                  Acknowledge
                </Button>
              )}
              {['pending', 'acknowledged'].includes(selectedRequest.status) && (
                <Button
                  variant="outline"
                  onClick={() => handleUpdateStatus('scheduled')}
                  disabled={updating || !scheduledDate}
                >
                  Schedule
                </Button>
              )}
              {['acknowledged', 'scheduled'].includes(selectedRequest.status) && (
                <Button
                  variant="outline"
                  onClick={() => handleUpdateStatus('in_progress')}
                  disabled={updating}
                >
                  Mark In Progress
                </Button>
              )}
              {['pending', 'acknowledged', 'scheduled', 'in_progress'].includes(selectedRequest.status) && (
                <Button
                  onClick={() => handleUpdateStatus('completed')}
                  disabled={updating}
                >
                  {updating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Mark Complete
                    </>
                  )}
                </Button>
              )}
              {selectedRequest.status !== 'cancelled' && selectedRequest.status !== 'completed' && (
                <Button
                  variant="outline"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => handleUpdateStatus('cancelled')}
                  disabled={updating}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <DispatchBar selection={selection} onEmail={() => setDispatchOpen(true)} />
      <DispatchEmailModal
        isOpen={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        orderIds={selection.orderIds}
        serviceRequestIds={selection.serviceRequestIds}
        onSent={() => {
          selection.clear()
          fetchRequests()
        }}
      />
    </div>
  )
}
