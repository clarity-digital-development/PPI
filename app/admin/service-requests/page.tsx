'use client'

import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import { formatDate } from '@/lib/utils'

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
  invoiceStatus: string | null
  invoicePaidAt: string | null
  user: {
    id: string
    email: string
    fullName: string | null
    phone: string | null
    company: string | null
  }
  installation: {
    id: string
    propertyAddress: string
    propertyCity: string
    propertyState: string
    propertyZip: string
    status: string
    order?: {
      orderNumber: string
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
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [adminNotes, setAdminNotes] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoicing, setInvoicing] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)

  useEffect(() => {
    fetchRequests()
  }, [filterStatus, filterType])

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterType) params.set('type', filterType)

      const res = await fetch(`/api/admin/service-requests?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setRequests(data.serviceRequests)
        setCounts(data.counts)
      }
    } catch (error) {
      console.error('Error fetching service requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewRequest = (request: ServiceRequest) => {
    setSelectedRequest(request)
    setAdminNotes(request.adminNotes || '')
    setScheduledDate(request.requestedDate ? request.requestedDate.split('T')[0] : '')
    setInvoiceAmount(request.invoiceAmount != null ? String(request.invoiceAmount) : '')
    setInvoiceError(null)
    setShowModal(true)
  }

  const handleSendInvoice = async () => {
    if (!selectedRequest) return
    const amt = Number(invoiceAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setInvoiceError('Enter a valid amount greater than $0.')
      return
    }
    setInvoicing(true)
    setInvoiceError(null)
    try {
      const res = await fetch(`/api/admin/service-requests/${selectedRequest.id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Charge failed')
      }
      // Merge the updated invoice fields into both the list and the open modal
      setRequests((prev) =>
        prev.map((r) => (r.id === selectedRequest.id ? { ...r, ...data.serviceRequest } : r))
      )
      setSelectedRequest((prev) => (prev ? { ...prev, ...data.serviceRequest } : prev))
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : 'Charge failed')
    } finally {
      setInvoicing(false)
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
        setRequests((prev) =>
          prev.map((r) => (r.id === selectedRequest.id ? { ...r, ...data.serviceRequest } : r))
        )
        setShowModal(false)
        fetchRequests() // Refresh counts
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
      return `${request.unlistedAddress}, ${request.unlistedCity}, ${request.unlistedState} ${request.unlistedZip} (unlisted — trip fee applies)`
    }
    return '(no address)'
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Service Requests</h1>
        <p className="text-gray-600">Manage customer service and removal requests</p>
      </div>

      {/* Status Cards */}
      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'pending' ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => setFilterStatus(filterStatus === 'pending' ? '' : 'pending')}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{counts.pending}</p>
              <p className="text-sm text-gray-600">Pending</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'acknowledged' ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => setFilterStatus(filterStatus === 'acknowledged' ? '' : 'acknowledged')}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{counts.acknowledged}</p>
              <p className="text-sm text-gray-600">Acknowledged</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'scheduled' ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => setFilterStatus(filterStatus === 'scheduled' ? '' : 'scheduled')}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{counts.scheduled}</p>
              <p className="text-sm text-gray-600">Scheduled</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'in_progress' ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => setFilterStatus(filterStatus === 'in_progress' ? '' : 'in_progress')}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{counts.in_progress}</p>
              <p className="text-sm text-gray-600">In Progress</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === 'completed' ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => setFilterStatus(filterStatus === 'completed' ? '' : 'completed')}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{counts.completed}</p>
              <p className="text-sm text-gray-600">Completed</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${filterStatus === '' ? 'ring-2 ring-pink-500' : ''}`}
            onClick={() => setFilterStatus('')}
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
            {(filterStatus || filterType) && (
              <Button
                variant="outline"
                className="self-end"
                onClick={() => {
                  setFilterStatus('')
                  setFilterType('')
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
            <Card key={request.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge variant={statusConfig[request.status]?.variant || 'neutral'}>
                        {statusConfig[request.status]?.label || request.status}
                      </Badge>
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

      {/* Detail Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Service Request Details"
      >
        {selectedRequest && (
          <div className="space-y-6">
            {/* Status & Type */}
            <div className="flex items-center gap-3">
              <Badge variant={statusConfig[selectedRequest.status]?.variant || 'neutral'}>
                {statusConfig[selectedRequest.status]?.label || selectedRequest.status}
              </Badge>
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
                <p className="text-sm text-gray-600">{selectedRequest.notes}</p>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Notes
                </label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all resize-none"
                  rows={3}
                  placeholder="Internal notes about this request..."
                />
              </div>
            </div>

            {/* Invoice — charge the customer's card on file for a variable
                service-trip amount (not always a flat $40) */}
            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-gray-500" />
                Invoice
              </h4>
              {selectedRequest.invoiceStatus === 'paid' ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                  Charged ${Number(selectedRequest.invoiceAmount ?? 0).toFixed(2)} to the customer&apos;s card on file
                  {selectedRequest.invoicePaidAt ? ` on ${formatDate(selectedRequest.invoicePaidAt)}` : ''}.
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Enter the amount to charge the customer&apos;s saved default card. They&apos;ll be charged immediately.
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        type="number"
                        label="Amount (USD)"
                        value={invoiceAmount}
                        onChange={(e) => setInvoiceAmount(e.target.value)}
                        placeholder="0.00"
                        icon={<DollarSign className="w-5 h-5" />}
                      />
                    </div>
                    <Button onClick={handleSendInvoice} disabled={invoicing || !invoiceAmount}>
                      {invoicing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Charging…
                        </>
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
    </div>
  )
}
