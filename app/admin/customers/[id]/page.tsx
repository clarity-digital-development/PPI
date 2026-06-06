'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Minus, Trash2, Package, Tag, Lock, FileBox, FileImage, Pencil, UserX, Archive, Users, X } from 'lucide-react'
import { Card, CardContent, Button, Input, Badge, Modal, SearchableSelect } from '@/components/ui'

interface CustomerData {
  customer: {
    id: string
    full_name: string
    email: string
    phone: string
    company_name: string | null
    license_number: string | null
    role: 'customer' | 'team_admin' | 'admin'
    is_service_area_exempt?: boolean
  }
  team: {
    id: string
    name: string
    members: Array<{ id: string; name: string; email: string | null; hasLogin: boolean }>
  } | null
  inventory: {
    signs: Array<{ id: string; description: string; size: string | null; quantity: number }>
    riders: Array<{ id: string; rider_id: string; rider_type: string; quantity: number }>
    lockboxes: Array<{ id: string; lockbox_type_id: string; lockbox_type: string; lockbox_code: string | null }>
    brochureBoxes: { id: string; quantity: number } | null
    otherItems: Array<{ id: string; description: string; quantity?: number }>
    items: {
      signs: Array<{ id: string; description: string; inStorage: boolean; assignedToMemberId: string | null }>
      riders: Array<{ id: string; riderName: string; inStorage: boolean; assignedToMemberId: string | null }>
      lockboxes: Array<{ id: string; type: string; code: string | null; serialNumber: string | null; inStorage: boolean; assignedToMemberId: string | null }>
      brochureBoxes: Array<{ id: string; description: string | null; inStorage: boolean; assignedToMemberId: string | null }>
    }
    deployed?: {
      signs: Array<{ id: string; description: string }>
      riders: Array<{ id: string; rider_type: string }>
      lockboxes: Array<{ id: string; lockbox_type: string; lockbox_code: string | null }>
      brochureBoxes: Array<{ id: string; description: string | null }>
    }
  }
  orders: Array<{
    id: string
    order_number: string
    status: string
    total: number
    created_at: string
  }>
  installations: Array<{
    id: string
    address: string
    city: string
    post_type: string
    status: string
    installation_date: string
  }>
}

export default function CustomerDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [data, setData] = useState<CustomerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [memberData, setMemberData] = useState({ name: '', email: '', phone: '' })
  const [addType, setAddType] = useState<'sign' | 'rider' | 'lockbox' | 'brochure_box' | 'other' | null>(null)
  const [formData, setFormData] = useState({
    description: '',
    size: '',
    quantity: 1,
    rider_type: '',
    lockbox_type: 'sentrilock',
    lockbox_code: '',
    assigned_to_member_id: '',
  })
  const [editData, setEditData] = useState<{
    full_name: string
    email: string
    phone: string
    company_name: string
    role: 'customer' | 'team_admin' | 'admin'
    is_service_area_exempt: boolean
  }>({
    full_name: '',
    email: '',
    phone: '',
    company_name: '',
    role: 'customer',
    is_service_area_exempt: false,
  })
  const [saving, setSaving] = useState(false)
  // Per-row selection for the agent-grouped bulk-reassign action bar.
  // Maps a composite key `${type}:${id}` to {type, id} so we can both
  // dedupe and serialize to the bulk endpoint without losing the type.
  const [selectedItems, setSelectedItems] = useState<Map<string, { type: 'sign' | 'rider' | 'lockbox' | 'brochure_box'; id: string }>>(new Map())
  const [reassignTargetId, setReassignTargetId] = useState<string>('')
  const [reassigning, setReassigning] = useState(false)
  // Per-row inline reassign in-flight, keyed by `${type}:${id}` — disables the dropdown so admins can't double-fire.
  const [rowReassigning, setRowReassigning] = useState<Record<string, boolean>>({})
  // Filter-by-agent: '' = all agents, 'unassigned' = team pool, else a memberId.
  const [agentFilter, setAgentFilter] = useState<string>('')

  // Opens Add Inventory modal — pre-seeds assignee from agentFilter when a specific agent is selected.
  function openAddModal(type: 'sign' | 'rider' | 'lockbox' | 'brochure_box' | 'other') {
    const preassign = agentFilter && agentFilter !== 'unassigned' ? agentFilter : ''
    setFormData({
      ...formData,
      assigned_to_member_id: preassign,
      ...(type === 'other' ? { description: '' } : {}),
    })
    setAddType(type)
    setShowAddModal(true)
  }

  useEffect(() => {
    fetchCustomer()
  }, [id])

  async function fetchCustomer() {
    try {
      const res = await fetch(`/api/admin/customers/${id}`)
      if (res.ok) {
        const data = await res.json()
        setData(data)
        setEditData({
          full_name: data.customer.full_name || '',
          email: data.customer.email || '',
          phone: data.customer.phone || '',
          company_name: data.customer.company_name || '',
          role: data.customer.role,
          is_service_area_exempt: data.customer.is_service_area_exempt ?? false,
        })
      }
    } catch (error) {
      console.error('Error fetching customer:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveCustomer() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/customers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: editData.full_name,
          email: editData.email,
          phone: editData.phone,
          company: editData.company_name,
          role: editData.role,
          is_service_area_exempt: editData.is_service_area_exempt,
        }),
      })
      if (res.ok) {
        setShowEditModal(false)
        fetchCustomer()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to update customer')
      }
    } catch (error) {
      console.error('Error updating customer:', error)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMember() {
    if (!memberData.name.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/customers/${id}/team-members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: memberData.name.trim(),
          email: memberData.email.trim() || undefined,
          phone: memberData.phone.trim() || undefined,
        }),
      })
      if (res.ok) {
        setShowAddMemberModal(false)
        setMemberData({ name: '', email: '', phone: '' })
        fetchCustomer()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to add team member')
      }
    } catch (error) {
      console.error('Error adding team member:', error)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCustomer() {
    if (!confirm('Are you sure you want to delete this customer? This will also delete all their inventory, orders, and data. This cannot be undone.')) return

    try {
      const res = await fetch(`/api/admin/customers/${id}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/admin/customers')
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to delete customer')
      }
    } catch (error) {
      console.error('Error deleting customer:', error)
    }
  }

  async function handleAddInventory() {
    if (!addType) return

    const body: Record<string, unknown> = { type: addType }
    if (addType === 'sign') {
      body.description = formData.description
      body.size = formData.size || null
      body.quantity = formData.quantity
    } else if (addType === 'rider') {
      body.rider_type = formData.rider_type
      body.quantity = formData.quantity
    } else if (addType === 'lockbox') {
      body.lockbox_type = formData.lockbox_type
      body.lockbox_code = formData.lockbox_code || null
      body.quantity = formData.quantity
    } else if (addType === 'brochure_box') {
      body.description = formData.description || null
      body.quantity = formData.quantity
    } else if (addType === 'other') {
      body.description = formData.description
      // Forward quantity so the API fans out N rows (Other has no qty column).
      body.quantity = formData.quantity
    }
    // Only forward the agent assignment if the customer actually has a
    // team — non-team customers don't have members to assign to. 'other'
    // items aren't agent-assignable anyway (no column on the table).
    if (formData.assigned_to_member_id && addType !== 'other') {
      body.assigned_to_member_id = formData.assigned_to_member_id
    }

    try {
      const res = await fetch(`/api/admin/customers/${id}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        setShowAddModal(false)
        setFormData({
          description: '',
          size: '',
          quantity: 1,
          rider_type: '',
          lockbox_type: 'sentrilock',
          lockbox_code: '',
          assigned_to_member_id: '',
        })
        fetchCustomer()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to add inventory')
      }
    } catch (error) {
      console.error('Error adding inventory:', error)
    }
  }

  async function handleDeleteInventory(type: string, itemId: string) {
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      const res = await fetch(
        `/api/admin/customers/${id}/inventory?type=${type}&item_id=${itemId}`,
        { method: 'DELETE' }
      )

      if (res.ok) {
        fetchCustomer()
      }
    } catch (error) {
      console.error('Error deleting inventory:', error)
    }
  }

  async function handleUpdateQuantity(type: 'rider' | 'lockbox', catalogId: string, newQuantity: number) {
    try {
      const res = await fetch(`/api/admin/customers/${id}/inventory`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, item_id: catalogId, quantity: newQuantity }),
      })
      if (res.ok) {
        fetchCustomer()
      }
    } catch (error) {
      console.error('Error updating quantity:', error)
    }
  }

  function toggleItemSelected(type: 'sign' | 'rider' | 'lockbox' | 'brochure_box', itemId: string) {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      const key = `${type}:${itemId}`
      if (next.has(key)) next.delete(key)
      else next.set(key, { type, id: itemId })
      return next
    })
  }

  function clearSelection() {
    setSelectedItems(new Map())
    setReassignTargetId('')
  }

  async function handleBulkReassign() {
    if (selectedItems.size === 0) return
    setReassigning(true)
    try {
      const res = await fetch(`/api/admin/customers/${id}/inventory/bulk-reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: Array.from(selectedItems.values()),
          target_member_id: reassignTargetId || null,
        }),
      })
      if (res.ok) {
        clearSelection()
        fetchCustomer()
      } else {
        const err = await res.json().catch(() => ({}))
        if (res.status === 409 && err.code === 'items_held') {
          alert('One or more selected items are in an active cart. Release the hold first via Admin → Inventory Holds, then try again.')
        } else {
          alert(err.error || 'Failed to reassign items')
        }
      }
    } catch (error) {
      console.error('Error bulk-reassigning items:', error)
      alert('Failed to reassign items')
    } finally {
      setReassigning(false)
    }
  }

  // Per-row inline reassign — reuses the bulk endpoint with a single-item payload so we share the hold-conflict logic.
  async function handleRowReassign(
    type: 'sign' | 'rider' | 'lockbox' | 'brochure_box',
    itemId: string,
    targetMemberId: string | null,
  ) {
    const key = `${type}:${itemId}`
    setRowReassigning((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await fetch(`/api/admin/customers/${id}/inventory/bulk-reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ type, id: itemId }],
          target_member_id: targetMemberId,
        }),
      })
      if (res.ok) {
        fetchCustomer()
      } else {
        const err = await res.json().catch(() => ({}))
        if (res.status === 409 && err.code === 'items_held') {
          alert('This item is in an active cart. Release the hold first via Admin → Inventory Holds, then try again.')
        } else {
          alert(err.error || 'Failed to reassign item')
        }
      }
    } catch (error) {
      console.error('Error reassigning item:', error)
      alert('Failed to reassign item')
    } finally {
      setRowReassigning((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  async function handleReturnToStorage(type: 'sign' | 'rider' | 'lockbox' | 'brochure_box', itemId: string) {
    try {
      const res = await fetch(`/api/admin/customers/${id}/inventory`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, item_id: itemId, action: 'return_to_storage' }),
      })
      if (res.ok) {
        fetchCustomer()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to return item to storage')
      }
    } catch (error) {
      console.error('Error returning item to storage:', error)
    }
  }

  // Per-type in-storage items filtered by the agentFilter selection.
  // Client-side only — the admin endpoint returns the full set in one call.
  const filteredInventory = useMemo(() => {
    const empty = {
      signs: [] as Array<{ id: string; description: string; assignedToMemberId: string | null }>,
      riders: [] as Array<{ id: string; riderName: string; assignedToMemberId: string | null }>,
      lockboxes: [] as Array<{ id: string; type: string; code: string | null; assignedToMemberId: string | null }>,
      brochureBoxes: [] as Array<{ id: string; description: string | null; assignedToMemberId: string | null }>,
    }
    if (!data?.inventory.items) return empty
    const items = data.inventory.items
    const matches = (memberId: string | null) =>
      agentFilter === '' ? true
      : agentFilter === 'unassigned' ? memberId === null
      : memberId === agentFilter
    return {
      signs: items.signs.filter(s => s.inStorage && matches(s.assignedToMemberId)),
      riders: items.riders.filter(r => r.inStorage && matches(r.assignedToMemberId)),
      lockboxes: items.lockboxes.filter(l => l.inStorage && matches(l.assignedToMemberId)),
      brochureBoxes: items.brochureBoxes.filter(b => b.inStorage && matches(b.assignedToMemberId)),
    }
  }, [data, agentFilter])

  // Per-agent grouping only makes sense when the customer's team has agents to assign to.
  const useGroupedView = !!(data?.team && data.team.members.length > 0)

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Customer not found</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Customers
        </Link>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{data.customer.full_name}</h1>
              {data.customer.role === 'admin' && (
                <Badge className="bg-purple-100 text-purple-800 border-purple-200">Admin</Badge>
              )}
              {data.customer.role === 'team_admin' && (
                <Badge className="bg-blue-100 text-blue-800 border-blue-200">Team Admin</Badge>
              )}
            </div>
            <p className="text-gray-600">{data.customer.email} {data.customer.phone && `\u2022 ${data.customer.phone}`}</p>
            {data.customer.company_name && (
              <p className="text-sm text-gray-500">{data.customer.company_name}</p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditModal(true)}
            >
              <Pencil className="w-4 h-4 mr-1" />
              Edit Info
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteCustomer}
              className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 hover:bg-red-50"
            >
              <UserX className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Team Members (only for team_admin customers) */}
      {data.team && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-pink-500" />
                <h2 className="font-semibold text-gray-900">Team Members</h2>
                <span className="text-sm text-gray-500">{data.team.name}</span>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setMemberData({ name: '', email: '', phone: '' })
                  setShowAddMemberModal(true)
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Member
              </Button>
            </div>
            {data.team.members.length > 0 ? (
              <div className={`space-y-2 ${data.team.members.length > 5 ? 'max-h-[300px] overflow-y-auto pr-1' : ''}`}>
                {data.team.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{member.name}</p>
                      {member.email && (
                        <p className="text-sm text-gray-500">{member.email}</p>
                      )}
                    </div>
                    <Badge variant={member.hasLogin ? 'success' : 'neutral'}>
                      {member.hasLogin ? 'Login' : 'Name only'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No members yet</p>
            )}
          </CardContent>
        </Card>
      )}

      {useGroupedView && data.team && (() => {
        // Local closure: capture deps so each card's per-row UX stays compact.
        const team = data.team
        const members = team.members
        // Dropdown options reused by every row — keep "Unassigned" parity with team-admin view.
        const memberOptions = [
          { value: '', label: 'Unassigned' },
          ...members.map((m) => ({ value: m.id, label: m.name })),
        ]
        const filterOptions = [
          { value: '', label: 'All agents' },
          ...members.map((m) => ({ value: m.id, label: m.name })),
          { value: 'unassigned', label: 'Unassigned' },
        ]

        // Per-row renderer — mirrors /dashboard/inventory:299-341 but adds the bulk checkbox + delete trash for admin.
        const renderRow = (
          type: 'sign' | 'rider' | 'lockbox' | 'brochure_box',
          item: { id: string; label: string; code?: string | null; assignedToMemberId: string | null },
        ) => {
          const key = `${type}:${item.id}`
          const saving = !!rowReassigning[key]
          const checked = selectedItems.has(key)
          return (
            <li
              key={item.id}
              className={`p-3 rounded-lg transition-colors ${checked ? 'bg-pink-50 ring-1 ring-pink-200' : 'bg-gray-50'}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <label className="flex items-center gap-3 min-w-0 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleItemSelected(type, item.id)}
                    className="w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500 flex-shrink-0"
                  />
                  <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{item.label}</span>
                  {item.code && (
                    <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded flex-shrink-0">
                      {item.code}
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <SearchableSelect
                    className="py-1.5 text-sm min-w-[180px]"
                    options={memberOptions}
                    value={item.assignedToMemberId ?? ''}
                    disabled={saving}
                    onChange={(next) => {
                      const nextId = next === '' ? null : next
                      // No-op if selection didn't change — avoids a needless POST.
                      if (nextId === (item.assignedToMemberId ?? null)) return
                      handleRowReassign(type, item.id, nextId)
                    }}
                    searchPlaceholder="Search agents..."
                    aria-label={`Assign ${item.label}`}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (confirm('Delete this item?')) handleDeleteInventory(type, item.id)
                    }}
                    className="text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          )
        }

        return (
          <div className="space-y-6">
            {/* Top-level "Add Inventory" cluster — pre-assigning at add time means
                admins don't need to drop down into each section to add. */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-700 mr-2">Add inventory:</span>
                  <Button size="sm" variant="outline" onClick={() => openAddModal('sign')}>
                    <Plus className="w-4 h-4 mr-1" /> Sign
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openAddModal('rider')}>
                    <Plus className="w-4 h-4 mr-1" /> Rider
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openAddModal('lockbox')}>
                    <Plus className="w-4 h-4 mr-1" /> Lockbox
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openAddModal('brochure_box')}>
                    <Plus className="w-4 h-4 mr-1" /> Brochure Box
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openAddModal('other')}>
                    <Plus className="w-4 h-4 mr-1" /> Other
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Filter by agent — mirrors /dashboard/inventory:363-380 — client-side filter over the already-loaded items. */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <label className="text-sm font-medium text-gray-700 sm:w-auto">Filter by agent</label>
                  <div className="sm:max-w-xs w-full">
                    <SearchableSelect
                      options={filterOptions}
                      value={agentFilter}
                      onChange={(next) => setAgentFilter(next)}
                      searchPlaceholder="Search agents..."
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Signs */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                      <FileImage className="w-5 h-5 text-pink-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Signs</h3>
                      <p className="text-sm text-gray-500">{filteredInventory.signs.length} in storage</p>
                    </div>
                  </div>
                  {filteredInventory.signs.length > 0 ? (
                    <ul className={filteredInventory.signs.length > 5 ? 'space-y-3 max-h-[280px] overflow-y-auto pr-1 -mr-1' : 'space-y-3'}>
                      {filteredInventory.signs.map(s => renderRow('sign', {
                        id: s.id, label: s.description, assignedToMemberId: s.assignedToMemberId,
                      }))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No signs in storage</p>
                  )}
                </CardContent>
              </Card>

              {/* Riders */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                      <Tag className="w-5 h-5 text-pink-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Riders</h3>
                      <p className="text-sm text-gray-500">{filteredInventory.riders.length} in storage</p>
                    </div>
                  </div>
                  {filteredInventory.riders.length > 0 ? (
                    <ul className={filteredInventory.riders.length > 5 ? 'space-y-3 max-h-[280px] overflow-y-auto pr-1 -mr-1' : 'space-y-3'}>
                      {filteredInventory.riders.map(r => renderRow('rider', {
                        id: r.id, label: r.riderName, assignedToMemberId: r.assignedToMemberId,
                      }))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No riders in storage</p>
                  )}
                </CardContent>
              </Card>

              {/* Lockboxes */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-pink-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Lockboxes</h3>
                      <p className="text-sm text-gray-500">{filteredInventory.lockboxes.length} in storage</p>
                    </div>
                  </div>
                  {filteredInventory.lockboxes.length > 0 ? (
                    <ul className={filteredInventory.lockboxes.length > 5 ? 'space-y-3 max-h-[280px] overflow-y-auto pr-1 -mr-1' : 'space-y-3'}>
                      {filteredInventory.lockboxes.map(l => renderRow('lockbox', {
                        id: l.id, label: l.type, code: l.code, assignedToMemberId: l.assignedToMemberId,
                      }))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No lockboxes in storage</p>
                  )}
                </CardContent>
              </Card>

              {/* Brochure Boxes */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                      <Archive className="w-5 h-5 text-pink-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Brochure Boxes</h3>
                      <p className="text-sm text-gray-500">{filteredInventory.brochureBoxes.length} in storage</p>
                    </div>
                  </div>
                  {filteredInventory.brochureBoxes.length > 0 ? (
                    <ul className={filteredInventory.brochureBoxes.length > 5 ? 'space-y-3 max-h-[280px] overflow-y-auto pr-1 -mr-1' : 'space-y-3'}>
                      {filteredInventory.brochureBoxes.map(b => renderRow('brochure_box', {
                        id: b.id, label: b.description || 'Brochure box', assignedToMemberId: b.assignedToMemberId,
                      }))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No brochure boxes in storage</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Other items remain a separate card — customer_other_items has no assignedToMemberId column,
                so the filter-by-agent control doesn't apply. Post-migration this list is typically empty. */}
            {data.inventory.otherItems && data.inventory.otherItems.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Archive className="w-5 h-5 text-pink-500" />
                      <h2 className="font-semibold text-gray-900">Other</h2>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {data.inventory.otherItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <p className="font-medium text-gray-900">
                          {item.description}
                          {item.quantity && item.quantity > 1 && (
                            <span className="ml-2 text-sm font-normal text-gray-500">×{item.quantity}</span>
                          )}
                        </p>
                        <button
                          onClick={() => handleDeleteInventory('other', item.id)}
                          className="text-gray-400 hover:text-red-500"
                          title={item.quantity && item.quantity > 1 ? 'Removes one of these items' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )
      })()}

      {!useGroupedView && (
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Signs */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-pink-500" />
                <h2 className="font-semibold text-gray-900">Signs in Storage</h2>
              </div>
              <Button
                size="sm"
                onClick={() => openAddModal('sign')}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            {data.inventory.signs.length > 0 ? (
              <div className="space-y-2">
                {data.inventory.signs.map((sign) => (
                  <div
                    key={sign.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {sign.description}{sign.quantity > 1 ? ` (\u00d7${sign.quantity})` : ''}
                      </p>
                      {sign.size && <p className="text-sm text-gray-500">{sign.size}</p>}
                    </div>
                    <button
                      onClick={() => handleDeleteInventory('sign', sign.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No signs in storage</p>
            )}
          </CardContent>
        </Card>

        {/* Riders */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-pink-500" />
                <h2 className="font-semibold text-gray-900">Riders in Storage</h2>
              </div>
              <Button
                size="sm"
                onClick={() => openAddModal('rider')}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            {data.inventory.riders.length > 0 ? (
              <div className={`space-y-2 ${data.inventory.riders.length > 5 ? 'max-h-[300px] overflow-y-auto pr-1' : ''}`}>
                {data.inventory.riders.map((rider) => (
                  <div
                    key={rider.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{rider.rider_type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity('rider', rider.rider_id, rider.quantity - 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-8 text-center font-medium text-gray-900">{rider.quantity}</span>
                      <button
                        onClick={() => handleUpdateQuantity('rider', rider.rider_id, rider.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteInventory('rider', rider.id)}
                        className="text-gray-400 hover:text-red-500 ml-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No riders in storage</p>
            )}
          </CardContent>
        </Card>

        {/* Lockboxes */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-pink-500" />
                <h2 className="font-semibold text-gray-900">Lockboxes in Storage</h2>
              </div>
              <Button
                size="sm"
                onClick={() => openAddModal('lockbox')}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            {data.inventory.lockboxes.length > 0 ? (
              <div className="space-y-2">
                {data.inventory.lockboxes.map((lockbox) => (
                  <div
                    key={lockbox.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900 capitalize">{lockbox.lockbox_type}</p>
                      {lockbox.lockbox_code && (
                        <p className="text-sm text-gray-500">Code: {lockbox.lockbox_code}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteInventory('lockbox', lockbox.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No lockboxes in storage</p>
            )}
          </CardContent>
        </Card>

        {/* Brochure Boxes */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileBox className="w-5 h-5 text-pink-500" />
                <h2 className="font-semibold text-gray-900">Brochure Boxes</h2>
              </div>
              <Button
                size="sm"
                onClick={() => openAddModal('brochure_box')}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {data.inventory.brochureBoxes?.quantity || 0}
              </p>
              <p className="text-sm text-gray-500">in storage</p>
            </div>
          </CardContent>
        </Card>

        {/* Other Items */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Archive className="w-5 h-5 text-pink-500" />
                <h2 className="font-semibold text-gray-900">Other</h2>
              </div>
              <Button
                size="sm"
                onClick={() => openAddModal('other')}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            {data.inventory.otherItems && data.inventory.otherItems.length > 0 ? (
              <div className="space-y-2">
                {data.inventory.otherItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <p className="font-medium text-gray-900">
                      {item.description}
                      {item.quantity && item.quantity > 1 && (
                        <span className="ml-2 text-sm font-normal text-gray-500">×{item.quantity}</span>
                      )}
                    </p>
                    <button
                      onClick={() => handleDeleteInventory('other', item.id)}
                      className="text-gray-400 hover:text-red-500"
                      title={item.quantity && item.quantity > 1 ? 'Removes one of these items' : 'Delete'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No other items</p>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {/* Sticky bulk-action bar — appears when ≥1 item is selected in the grouped view. */}
      {useGroupedView && selectedItems.size > 0 && data.team && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(720px,calc(100vw-2rem))]">
          <div className="bg-white border border-pink-300 shadow-lg rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-900">
              {selectedItems.size} item{selectedItems.size === 1 ? '' : 's'} selected
            </span>
            <span className="text-sm text-gray-500">·</span>
            <span className="text-sm text-gray-700">Reassign to:</span>
            <select
              value={reassignTargetId}
              onChange={(e) => setReassignTargetId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none"
            >
              <option value="">Unassigned (team pool)</option>
              {data.team.members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={handleBulkReassign} disabled={reassigning}>
              {reassigning ? 'Applying…' : 'Apply'}
            </Button>
            <Button size="sm" variant="outline" onClick={clearSelection}>
              <X className="w-4 h-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Deployed (out of storage) inventory */}
      {data.inventory.deployed && (
        (data.inventory.deployed.signs.length +
         data.inventory.deployed.riders.length +
         data.inventory.deployed.lockboxes.length +
         data.inventory.deployed.brochureBoxes.length) > 0
      ) && (
        <Card className="mt-6 border-amber-200 bg-amber-50/40">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold text-gray-900">Currently Deployed</h2>
              <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-medium">
                Out of inventory
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              These items are out on a property. Click &quot;Return to inventory&quot; once the customer has them back.
            </p>
            <div className="space-y-2">
              {data.inventory.deployed.signs.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200">
                  <div className="text-sm">
                    <span className="text-xs text-amber-700 font-medium uppercase mr-2">Sign</span>
                    <span className="text-gray-900">{item.description}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleReturnToStorage('sign', item.id)}>
                    Return to inventory
                  </Button>
                </div>
              ))}
              {data.inventory.deployed.riders.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200">
                  <div className="text-sm">
                    <span className="text-xs text-amber-700 font-medium uppercase mr-2">Rider</span>
                    <span className="text-gray-900">{item.rider_type}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleReturnToStorage('rider', item.id)}>
                    Return to inventory
                  </Button>
                </div>
              ))}
              {data.inventory.deployed.lockboxes.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200">
                  <div className="text-sm">
                    <span className="text-xs text-amber-700 font-medium uppercase mr-2">Lockbox</span>
                    <span className="text-gray-900">
                      {item.lockbox_type}{item.lockbox_code ? ` — code ${item.lockbox_code}` : ''}
                    </span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleReturnToStorage('lockbox', item.id)}>
                    Return to inventory
                  </Button>
                </div>
              ))}
              {data.inventory.deployed.brochureBoxes.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200">
                  <div className="text-sm">
                    <span className="text-xs text-amber-700 font-medium uppercase mr-2">Brochure Box</span>
                    <span className="text-gray-900">{item.description || 'Brochure box'}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleReturnToStorage('brochure_box', item.id)}>
                    Return to inventory
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Orders */}
      <Card className="mt-6">
        <CardContent className="p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Recent Orders</h2>
          {data.orders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Order #</th>
                    <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.orders.slice(0, 10).map((order) => (
                    <tr key={order.id}>
                      <td className="py-3 font-medium">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="text-pink-600 hover:text-pink-700 hover:underline"
                        >
                          {order.order_number}
                        </Link>
                      </td>
                      <td className="py-3 text-gray-600">
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3">
                        <Badge variant={order.status === 'completed' ? 'success' : 'neutral'}>
                          {order.status}
                        </Badge>
                      </td>
                      <td className="py-3 text-right font-medium text-gray-900">
                        ${order.total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No orders yet</p>
          )}
        </CardContent>
      </Card>

      {/* Edit Customer Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Customer Info"
      >
        <div className="space-y-4">
          <Input
            label="Full Name"
            value={editData.full_name}
            onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            value={editData.email}
            onChange={(e) => setEditData({ ...editData, email: e.target.value })}
          />
          <Input
            label="Phone"
            value={editData.phone}
            onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
          />
          <Input
            label="Company"
            value={editData.company_name}
            onChange={(e) => setEditData({ ...editData, company_name: e.target.value })}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={editData.role}
              onChange={(e) => setEditData({ ...editData, role: e.target.value as 'customer' | 'team_admin' | 'admin' })}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
            >
              <option value="customer">Customer</option>
              <option value="team_admin">Team Admin (brokerage)</option>
              <option value="admin">Admin (Pink Posts internal)</option>
            </select>
            {editData.role === 'admin' && data.customer.role !== 'admin' && (
              <p className="mt-1 text-xs text-amber-700">
                Promoting to <strong>Admin</strong> grants full Pink Posts admin access (all customers, orders, billing).
              </p>
            )}
            {editData.role !== 'admin' && data.customer.role === 'admin' && (
              <p className="mt-1 text-xs text-amber-700">
                Demoting from <strong>Admin</strong> will revoke all Pink Posts admin access for this user.
              </p>
            )}
          </div>
          {/* Per-customer service-area exemption. team_admin role is exempt automatically;
              this flag covers individual relationship/VIP customers we want to accommodate. */}
          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editData.is_service_area_exempt}
                onChange={(e) => setEditData({ ...editData, is_service_area_exempt: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
              />
              <span className="text-sm">
                <span className="font-medium text-gray-700">Exempt from out-of-area service fee</span>
                <span className="block text-xs text-gray-500">
                  Bypasses the surcharge band and the hard cutoff for this customer. Team Admin accounts are exempt automatically.
                </span>
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCustomer} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Team Member Modal */}
      <Modal
        isOpen={showAddMemberModal}
        onClose={() => setShowAddMemberModal(false)}
        title="Add Team Member"
      >
        <div className="space-y-4">
          <Input
            label="Name *"
            value={memberData.name}
            onChange={(e) => setMemberData({ ...memberData, name: e.target.value })}
            placeholder="e.g., Jane Smith"
          />
          <Input
            label="Email"
            type="email"
            value={memberData.email}
            onChange={(e) => setMemberData({ ...memberData, email: e.target.value })}
            placeholder="jane@example.com"
          />
          <Input
            label="Phone"
            value={memberData.phone}
            onChange={(e) => setMemberData({ ...memberData, phone: e.target.value })}
            placeholder="859-555-1234"
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowAddMemberModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddMember} disabled={saving || !memberData.name.trim()}>
              {saving ? 'Adding...' : 'Add Member'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Inventory Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={`Add ${addType === 'sign' ? 'Sign' : addType === 'rider' ? 'Rider' : addType === 'brochure_box' ? 'Brochure Box' : addType === 'other' ? 'Other Item' : 'Lockbox'}`}
      >
        <div className="space-y-4">
          {addType === 'sign' && (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Quick presets</p>
                <div className="flex flex-wrap gap-2">
                  {['For Sale Sign', 'Coming Soon', 'SOLD', 'Pending', 'Open House', 'Under Contract'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFormData({ ...formData, description: preset })}
                      className="px-3 py-1.5 rounded-full border border-pink-200 bg-pink-50 text-pink-700 text-sm font-medium hover:bg-pink-100 transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                label="Description *"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="e.g., Ryan Richardson 859-555-1234"
              />
              <Input
                label="Size"
                value={formData.size}
                onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                placeholder="e.g., 24x30"
              />
            </>
          )}
          {addType === 'rider' && (
            <Input
              label="Rider Type *"
              value={formData.rider_type}
              onChange={(e) => setFormData({ ...formData, rider_type: e.target.value })}
              placeholder="e.g., Sold, Coming Soon, etc."
            />
          )}
          {addType === 'lockbox' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                <select
                  value={formData.lockbox_type}
                  onChange={(e) => setFormData({ ...formData, lockbox_type: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none"
                >
                  <option value="sentrilock">Sentrilock/Supra</option>
                  <option value="mechanical_own">Mechanical (Customer Owned)</option>
                  <option value="mechanical_rent">Mechanical (Rental)</option>
                </select>
              </div>
              <Input
                label="Code"
                value={formData.lockbox_code}
                onChange={(e) => setFormData({ ...formData, lockbox_code: e.target.value })}
                placeholder="e.g., 1234"
              />
            </>
          )}
          {addType === 'brochure_box' && (
            <Input
              label="Description (optional)"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g., Clear acrylic box"
            />
          )}
          {addType === 'other' && (
            <Input
              label="Description *"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g., Metal frame sign"
            />
          )}
          {addType && (
            <Input
              label="Quantity"
              type="number"
              min={1}
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
            />
          )}
          {/* Assign-at-add: only for team_admin customers with members,
              and not for "other" items (no assignment column on that table). */}
          {addType !== 'other' && data.team && data.team.members.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assign to agent <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              {/* SearchableSelect scales to 1000+ agents — plain dropdown breaks down past ~20. */}
              <SearchableSelect
                value={formData.assigned_to_member_id}
                onChange={(next) => setFormData({ ...formData, assigned_to_member_id: next })}
                options={[
                  { value: '', label: 'Unassigned (team pool)' },
                  ...data.team.members.map((m) => ({ value: m.id, label: m.name })),
                ]}
                placeholder="Unassigned (team pool)"
                searchPlaceholder="Search agents..."
                aria-label="Assign to agent"
              />
              <p className="mt-1 text-xs text-gray-500">
                Pre-assigning saves the team admin a step — they won&apos;t need to reassign in &quot;Team Inventory&quot; later.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddInventory}>Add</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
