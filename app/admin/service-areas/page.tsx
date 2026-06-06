'use client'

import { useEffect, useState } from 'react'
import { MapPin, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react'
import { Card, CardContent, Button, Input, Badge, Modal } from '@/components/ui'

interface ServiceCenter {
  id: string
  name: string
  addressLine: string | null
  city: string
  state: string
  zip: string
  // Prisma Decimals serialize to string over JSON — keep both shapes accepted so we don't blow up if Next.js changes serialization.
  lat: string | number
  lng: string | number
  standardMinutes: number
  surchargeMinutes: number
  surchargeCents: number
  contactPhone: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface FormState {
  name: string
  addressLine: string
  city: string
  state: string
  zip: string
  lat: string
  lng: string
  standardMinutes: string
  surchargeMinutes: string
  // We collect dollars in the UI but POST cents to the API.
  surchargeDollars: string
  contactPhone: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  addressLine: '',
  city: '',
  state: 'KY',
  zip: '',
  lat: '',
  lng: '',
  standardMinutes: '45',
  surchargeMinutes: '90',
  surchargeDollars: '50',
  contactPhone: '859-395-8188',
  isActive: true,
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`
}

function centerToForm(c: ServiceCenter): FormState {
  return {
    name: c.name,
    addressLine: c.addressLine ?? '',
    city: c.city,
    state: c.state,
    zip: c.zip,
    lat: String(c.lat),
    lng: String(c.lng),
    standardMinutes: String(c.standardMinutes),
    surchargeMinutes: String(c.surchargeMinutes),
    surchargeDollars: (c.surchargeCents / 100).toFixed(2),
    contactPhone: c.contactPhone,
    isActive: c.isActive,
  }
}

export default function ServiceAreasPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetchCenters()
  }, [])

  async function fetchCenters() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/service-centers')
      if (res.ok) {
        const data = await res.json()
        setCenters(data.centers ?? [])
      }
    } catch (err) {
      console.error('Error fetching service centers', err)
    } finally {
      setLoading(false)
    }
  }

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowModal(true)
  }

  function openEdit(c: ServiceCenter) {
    setEditingId(c.id)
    setForm(centerToForm(c))
    setFormError(null)
    setShowModal(true)
  }

  async function handleSave() {
    setFormError(null)

    // Coerce + validate up-front so we can show a friendly error without round-tripping to the server.
    const lat = Number(form.lat)
    const lng = Number(form.lng)
    const standardMinutes = Number(form.standardMinutes)
    const surchargeMinutes = Number(form.surchargeMinutes)
    const surchargeDollars = Number(form.surchargeDollars)

    if (!form.name.trim()) return setFormError('Name is required')
    if (!form.city.trim()) return setFormError('City is required')
    if (!/^[A-Z]{2}$/i.test(form.state)) return setFormError('State must be 2 letters')
    if (!/^\d{5}$/.test(form.zip.trim())) return setFormError('ZIP must be 5 digits')
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return setFormError('Latitude must be between -90 and 90')
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return setFormError('Longitude must be between -180 and 180')
    if (!Number.isInteger(standardMinutes) || standardMinutes <= 0) return setFormError('Standard band minutes must be a positive integer')
    if (!Number.isInteger(surchargeMinutes) || surchargeMinutes <= 0) return setFormError('Surcharge band minutes must be a positive integer')
    if (surchargeMinutes <= standardMinutes) return setFormError('Surcharge band must exceed standard band')
    if (!Number.isFinite(surchargeDollars) || surchargeDollars < 0) return setFormError('Surcharge fee must be a non-negative number')
    if (!form.contactPhone.trim()) return setFormError('Contact phone is required')

    const payload = {
      name: form.name.trim(),
      addressLine: form.addressLine.trim() || null,
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      zip: form.zip.trim(),
      lat,
      lng,
      standardMinutes,
      surchargeMinutes,
      surchargeCents: Math.round(surchargeDollars * 100),
      contactPhone: form.contactPhone.trim(),
      isActive: form.isActive,
    }

    setSaving(true)
    try {
      const url = editingId
        ? `/api/admin/service-centers/${editingId}`
        : '/api/admin/service-centers'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setShowModal(false)
        await fetchCenters()
      } else {
        const err = await res.json().catch(() => ({}))
        setFormError(err.error || 'Failed to save service center')
      }
    } catch (err) {
      console.error('Error saving service center', err)
      setFormError('Failed to save service center')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: ServiceCenter) {
    if (!confirm(`Deactivate "${c.name}"? It will stop routing new orders. You can reactivate via Edit.`)) return
    try {
      const res = await fetch(`/api/admin/service-centers/${c.id}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchCenters()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to deactivate')
      }
    } catch (err) {
      console.error('Error deactivating service center', err)
      alert('Failed to deactivate')
    }
  }

  async function handleReactivate(c: ServiceCenter) {
    try {
      const res = await fetch(`/api/admin/service-centers/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      if (res.ok) {
        await fetchCenters()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to reactivate')
      }
    } catch (err) {
      console.error('Error reactivating service center', err)
      alert('Failed to reactivate')
    }
  }

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-6 h-6 text-pink-500" />
            <h1 className="text-2xl font-bold text-gray-900">Service Areas</h1>
          </div>
          <p className="text-gray-600 mt-1">
            Each center has two drive-time bands. Standard band = no fee. Surcharge band = flat fee added.
            Outside both bands = the customer sees a phone number instead of a checkout button.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1" />
          Add Service Center
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : centers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">No service centers yet.</p>
              <p className="text-sm text-gray-400 mt-1">
                Heads up: with zero active centers the wizard fails OPEN — every ZIP routes as standard.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Standard ≤</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Surcharge ≤</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Fee</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {centers.map((c) => (
                    <tr key={c.id} className={c.isActive ? '' : 'bg-gray-50/60'}>
                      <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {c.city}, {c.state} {c.zip}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatMinutes(c.standardMinutes)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatMinutes(c.surchargeMinutes)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatCents(c.surchargeCents)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{c.contactPhone}</td>
                      <td className="px-4 py-3">
                        {c.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="neutral">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                            <Pencil className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          {c.isActive ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(c)}
                              className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Deactivate
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => handleReactivate(c)}>
                              <RotateCcw className="w-4 h-4 mr-1" />
                              Reactivate
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? 'Edit Service Center' : 'Add Service Center'}
      >
        <div className="space-y-4">
          <Input
            label="Name *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Lexington"
          />

          <Input
            label="Street address"
            value={form.addressLine}
            onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
            placeholder="123 Main St"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="City *"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="Lexington"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">State *</label>
              <select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              >
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label="ZIP *"
            value={form.zip}
            onChange={(e) => setForm({ ...form, zip: e.target.value })}
            placeholder="40507"
            maxLength={5}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Latitude *"
              type="number"
              step="0.000001"
              value={form.lat}
              onChange={(e) => setForm({ ...form, lat: e.target.value })}
              placeholder="38.0406"
            />
            <Input
              label="Longitude *"
              type="number"
              step="0.000001"
              value={form.lng}
              onChange={(e) => setForm({ ...form, lng: e.target.value })}
              placeholder="-84.5037"
            />
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            Tip: open Google Maps, right-click the shop, click the coordinates to copy. Paste lat first, then lng.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Standard band (minutes) *"
              type="number"
              min={1}
              value={form.standardMinutes}
              onChange={(e) => setForm({ ...form, standardMinutes: e.target.value })}
              helperText="Drive time ≤ this = no fee"
            />
            <Input
              label="Surcharge band (minutes) *"
              type="number"
              min={1}
              value={form.surchargeMinutes}
              onChange={(e) => setForm({ ...form, surchargeMinutes: e.target.value })}
              helperText="Drive time ≤ this = flat fee. Above = no service."
            />
          </div>

          <Input
            label="Surcharge fee ($) *"
            type="number"
            min={0}
            step="0.01"
            value={form.surchargeDollars}
            onChange={(e) => setForm({ ...form, surchargeDollars: e.target.value })}
            helperText="Flat dollar amount added when the property falls in the surcharge band"
          />

          <Input
            label="Contact phone *"
            value={form.contactPhone}
            onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            placeholder="859-395-8188"
            helperText="Shown to customers when their ZIP is outside every active center"
          />

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
            />
            <span className="text-sm text-gray-700">Active (routes new orders)</span>
          </label>

          {formError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Center'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
