'use client'

import { useEffect, useState } from 'react'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Button, Modal, Input, Select } from '@/components/ui'
import { ScheduleTripModal } from '@/components/dashboard/installation-modals'
import {
  Loader2,
  MapPin,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Wrench,
  Trash2,
  RefreshCw,
  FileText,
  Truck,
  Pencil,
  Ban,
} from 'lucide-react'

interface ServiceRequest {
  id: string
  type: 'removal' | 'service' | 'repair' | 'replacement'
  status: 'pending' | 'acknowledged' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  description: string | null
  requestedDate: string | null
  notes: string | null
  adminNotes: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  // Invoice billing state — surfaced as a status badge so the customer can
  // see whether a trip charge is queued ('pending_invoice'), already paid
  // ('paid'), or failed to charge ('failed' — rare, charge will retry).
  invoiceStatus: 'paid' | 'pending_invoice' | 'failed' | null
  invoiceAmount: number | string | null
  // team view: which member the request belongs to
  userId?: string
  userName?: string | null
  installation: {
    id: string
    address: string
    status: string
  } | null
}

interface StatusCounts {
  pending: number
  acknowledged: number
  scheduled: number
  in_progress: number
  completed: number
  cancelled: number
  total: number
}

const statusConfig: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral'; icon: typeof Clock }> = {
  pending: { label: 'Pending', variant: 'warning', icon: Clock },
  acknowledged: { label: 'Acknowledged', variant: 'info', icon: FileText },
  scheduled: { label: 'Scheduled', variant: 'info', icon: Calendar },
  in_progress: { label: 'In Progress', variant: 'info', icon: RefreshCw },
  completed: { label: 'Completed', variant: 'success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', variant: 'error', icon: XCircle },
}

const typeConfig: Record<string, { label: string; icon: typeof Wrench }> = {
  removal: { label: 'Sign Removal', icon: Trash2 },
  service: { label: 'Service', icon: Wrench },
  repair: { label: 'Repair', icon: Wrench },
  replacement: { label: 'Replacement', icon: RefreshCw },
}

export default function ServiceRequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [counts, setCounts] = useState<StatusCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showTripModal, setShowTripModal] = useState(false)
  const [editing, setEditing] = useState<ServiceRequest | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // team_admin only: roster (members with logins) for the "filter by agent"
  // control, which narrows to one member's requests.
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)
  const [members, setMembers] = useState<Array<{ userId: string; name: string }>>([])
  const [memberFilter, setMemberFilter] = useState('') // '' = all, else a member's userId

  const ACTIVE_STATUSES = ['pending', 'acknowledged', 'scheduled']
  const isActive = (status: string) => ACTIVE_STATUSES.includes(status)

  const fetchRequests = async () => {
    setLoading(true)
    setError(null)

    try {
      const url = memberFilter
        ? `/api/service-requests?member_id=${encodeURIComponent(memberFilter)}`
        : '/api/service-requests'
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error('Failed to fetch service requests')
      }

      const data = await res.json()
      setRequests(data.serviceRequests || [])
      setCounts(data.counts || null)
    } catch (err) {
      console.error('Error fetching service requests:', err)
      setError(err instanceof Error ? err.message : 'Failed to load service requests')
    } finally {
      setLoading(false)
    }
  }

  // Resolve role + roster once (team_admins get the agent filter). Only members
  // with a login account can own service requests, so only those are listed.
  useEffect(() => {
    async function fetchRoleAndRoster() {
      try {
        const profileRes = await fetch('/api/profile')
        const role = profileRes.ok ? (await profileRes.json()).user?.role : null
        if (role === 'team_admin') {
          setIsTeamAdmin(true)
          const teamsRes = await fetch('/api/teams')
          if (teamsRes.ok) {
            const data = await teamsRes.json()
            const withLogin = (Array.isArray(data.members) ? data.members : [])
              .filter((m: { hasLogin: boolean; userId: string | null }) => m.hasLogin && m.userId)
              .map((m: { userId: string; name: string }) => ({ userId: m.userId, name: m.name }))
            setMembers(withLogin)
          }
        }
      } catch (err) {
        console.error('Error loading team roster:', err)
      }
    }
    fetchRoleAndRoster()
  }, [])

  // (Re)load requests on mount and whenever the agent filter changes.
  useEffect(() => {
    fetchRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberFilter])

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const openEdit = (request: ServiceRequest) => {
    setEditError(null)
    setEditing(request)
    // requestedDate comes back as an ISO string stored at noon UTC — take the
    // YYYY-MM-DD portion so the date input shows the calendar date the customer picked.
    setEditDate(request.requestedDate ? request.requestedDate.slice(0, 10) : '')
    setEditNotes(request.notes || '')
    setEditDescription(request.description || '')
  }

  const closeEdit = () => {
    setEditing(null)
    setEditError(null)
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    setEditError(null)

    try {
      const res = await fetch(`/api/service-requests/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_date: editDate || null,
          notes: editNotes,
          description: editDescription,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update request')
      }

      closeEdit()
      await fetchRequests()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update request')
    } finally {
      setSaving(false)
    }
  }

  const cancelRequest = async (request: ServiceRequest) => {
    if (!window.confirm('Cancel this service request? This cannot be undone.')) {
      return
    }

    setCancellingId(request.id)
    try {
      const res = await fetch(`/api/service-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: true }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to cancel request')
      }

      await fetchRequests()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel request')
    } finally {
      setCancellingId(null)
    }
  }

  const filterRequests = (status: string | null) => {
    if (!status || status === 'all') return requests
    if (status === 'active') {
      return requests.filter((r) => !['completed', 'cancelled'].includes(r.status))
    }
    return requests.filter((r) => r.status === status)
  }

  const RequestCard = ({ request }: { request: ServiceRequest }) => {
    const statusCfg = statusConfig[request.status] || statusConfig.pending
    const typeCfg = typeConfig[request.type] || typeConfig.service
    const StatusIcon = statusCfg.icon
    const TypeIcon = typeCfg.icon

    return (
      <Card variant="bordered" className="mb-4">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Type and Status */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <TypeIcon className="w-4 h-4 text-gray-500" />
                  <span className="font-semibold text-gray-900">{typeCfg.label}</span>
                </div>
                <Badge variant={statusCfg.variant}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {statusCfg.label}
                </Badge>
                {/* Invoice status — visible to the customer so they know what
                    their next invoice will include. 'failed' is intentionally
                    not surfaced to the customer (admin will reach out
                    out-of-band). */}
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
              </div>

              {/* Team view: whose request this is */}
              {isTeamAdmin && request.userName && (
                <p className="text-xs text-pink-600 mb-2">Requested by: {request.userName}</p>
              )}

              {/* Address */}
              {request.installation && (
                <div className="flex items-start gap-2 mb-3">
                  <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-gray-600">{request.installation.address}</p>
                </div>
              )}

              {/* Description */}
              {request.description && (
                <p className="text-sm text-gray-700 mb-3">{request.description}</p>
              )}

              {/* Dates */}
              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Created: {formatDate(request.createdAt)}</span>
                </div>
                {request.requestedDate && (
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>Requested: {formatDate(request.requestedDate)}</span>
                  </div>
                )}
                {request.completedAt && (
                  <div className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>Completed: {formatDate(request.completedAt)}</span>
                  </div>
                )}
              </div>

              {/* Notes from admin */}
              {request.adminNotes && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">Admin Notes:</p>
                  <p className="text-sm text-gray-700">{request.adminNotes}</p>
                </div>
              )}

              {/* Customer actions — only while the request is still active */}
              {isActive(request.status) && (
                <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(request)}
                  >
                    <Pencil className="w-4 h-4 mr-1.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    isLoading={cancellingId === request.id}
                    onClick={() => cancelRequest(request)}
                  >
                    <Ban className="w-4 h-4 mr-1.5" />
                    Cancel request
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <div>
        <Header title="Service Requests" />
        <div className="p-6 flex items-center justify-center min-h-[400px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
            <p className="text-gray-500">Loading service requests...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Header title="Service Requests" />
        <div className="p-6">
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
              <p className="text-red-700">{error}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header title="Service Requests" />

      <div className="p-6">
        {/* Action row: team_admin agent filter (left) + Schedule a Trip (right) */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
          {isTeamAdmin && members.length > 0 ? (
            <div className="max-w-xs w-full">
              <Select
                label="Filter by agent"
                placeholder=""
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                options={[
                  { value: '', label: 'All agents' },
                  ...members.map((m) => ({ value: m.userId, label: m.name })),
                ]}
              />
            </div>
          ) : (
            <div />
          )}
          <Button onClick={() => setShowTripModal(true)}>
            <Truck className="w-4 h-4 mr-2" />
            Schedule a Trip
          </Button>
        </div>

        {/* Summary Cards */}
        {counts && counts.total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <Card variant="bordered">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-pink-600">{counts.total}</p>
                <p className="text-sm text-gray-500">Total Requests</p>
              </CardContent>
            </Card>
            <Card variant="bordered">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-yellow-600">
                  {counts.pending + counts.acknowledged}
                </p>
                <p className="text-sm text-gray-500">Pending</p>
              </CardContent>
            </Card>
            <Card variant="bordered">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-blue-600">
                  {counts.scheduled + counts.in_progress}
                </p>
                <p className="text-sm text-gray-500">In Progress</p>
              </CardContent>
            </Card>
            <Card variant="bordered">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{counts.completed}</p>
                <p className="text-sm text-gray-500">Completed</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Requests List */}
        {requests.length === 0 ? (
          <Card variant="bordered">
            <CardContent className="p-8 text-center">
              <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Service Requests</h3>
              <p className="text-gray-500">
                You haven&apos;t submitted any service requests yet. Service requests can be
                submitted from your installation details.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="all" variant="pills">
            <TabsList className="mb-6">
              <TabsTrigger value="all">All ({requests.length})</TabsTrigger>
              <TabsTrigger value="active">
                Active ({filterRequests('active').length})
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed ({counts?.completed || 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all">
              {filterRequests('all').map((request) => (
                <RequestCard key={request.id} request={request} />
              ))}
            </TabsContent>
            <TabsContent value="active">
              {filterRequests('active').length === 0 ? (
                <Card variant="bordered">
                  <CardContent className="p-6 text-center text-gray-500">
                    No active service requests
                  </CardContent>
                </Card>
              ) : (
                filterRequests('active').map((request) => (
                  <RequestCard key={request.id} request={request} />
                ))
              )}
            </TabsContent>
            <TabsContent value="completed">
              {filterRequests('completed').length === 0 ? (
                <Card variant="bordered">
                  <CardContent className="p-6 text-center text-gray-500">
                    No completed service requests
                  </CardContent>
                </Card>
              ) : (
                filterRequests('completed').map((request) => (
                  <RequestCard key={request.id} request={request} />
                ))
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Schedule Trip Modal */}
      <ScheduleTripModal
        isOpen={showTripModal}
        onClose={() => setShowTripModal(false)}
        onSuccess={() => {
          setShowTripModal(false)
          fetchRequests()
        }}
      />

      {/* Edit Request Modal */}
      <Modal isOpen={!!editing} onClose={closeEdit} title="Edit Service Request">
        <div className="space-y-4">
          <Input
            type="date"
            label="Requested Date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              className="block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all duration-200"
              placeholder="What do you need?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes
            </label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={3}
              className="block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all duration-200"
              placeholder="Anything else we should know?"
            />
          </div>

          {editError && (
            <p className="text-sm text-error">{editError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={closeEdit} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEdit} isLoading={saving}>
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
