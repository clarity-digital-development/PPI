'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Minus, Trash2, Package, Tag, Lock, FileBox, Pencil, UserX } from 'lucide-react'
import { Card, CardContent, Button, Input, Badge, Modal } from '@/components/ui'

interface CustomerData {
  customer: {
    id: string
    full_name: string
    email: string
    phone: string
    company_name: string | null
    license_number: string | null
  }
  inventory: {
    signs: Array<{ id: string; description: string; size: string | null; quantity: number }>
    riders: Array<{ id: string; rider_id: string; rider_type: string; quantity: number }>
    lockboxes: Array<{ id: string; lockbox_type_id: string; lockbox_type: string; lockbox_code: string | null; quantity: number }>
    brochureBoxes: { id: string; quantity: number } | null
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
  const [addType, setAddType] = useState<'sign' | 'rider' | 'lockbox' | 'brochure_box' | null>(null)
  const [formData, setFormData] = useState({
    description: '',
    size: '',
    quantity: 1,
    rider_type: '',
    lockbox_type: 'sentrilock',
    lockbox_code: '',
  })
  const [editData, setEditData] = useState({
    full_name: '',
    email: '',
    phone: '',
    company_name: '',
  })
  const [saving, setSaving] = useState(false)

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
        }),
      })
      if (res.ok) {
        setShowEditModal(false)
        fetchCustomer()
      }
    } catch (error) {
      console.error('Error updating customer:', error)
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
            <h1 className="text-2xl font-bold text-gray-900">{data.customer.full_name}</h1>
            <p className="text-gray-600">{data.customer.email} {data.customer.phone && `\u2022 ${data.customer.phone}`}</p>
            {data.customer.company_name && (
              <p className="text-sm text-gray-500">{data.customer.company_name}</p>
            )}
          </div>
          <div className="flex gap-2">
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
                onClick={() => {
                  setAddType('sign')
                  setShowAddModal(true)
                }}
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
                      <p className="font-medium text-gray-900">{sign.description}</p>
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
                onClick={() => {
                  setAddType('rider')
                  setShowAddModal(true)
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            {data.inventory.riders.length > 0 ? (
              <div className="space-y-2">
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
                onClick={() => {
                  setAddType('lockbox')
                  setShowAddModal(true)
                }}
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
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity('lockbox', lockbox.lockbox_type_id, lockbox.quantity - 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-8 text-center font-medium text-gray-900">{lockbox.quantity}</span>
                      <button
                        onClick={() => handleUpdateQuantity('lockbox', lockbox.lockbox_type_id, lockbox.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteInventory('lockbox', lockbox.id)}
                        className="text-gray-400 hover:text-red-500 ml-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
                onClick={() => {
                  setAddType('brochure_box')
                  setShowAddModal(true)
                }}
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
      </div>

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
                      <td className="py-3 font-medium text-gray-900">{order.order_number}</td>
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

      {/* Add Inventory Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={`Add ${addType === 'sign' ? 'Sign' : addType === 'rider' ? 'Rider' : addType === 'brochure_box' ? 'Brochure Box' : 'Lockbox'}`}
      >
        <div className="space-y-4">
          {addType === 'sign' && (
            <>
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
                  <option value="sentrilock">SentriLock</option>
                  <option value="mechanical">Mechanical</option>
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
          <Input
            label="Quantity"
            type="number"
            min={1}
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
          />
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
