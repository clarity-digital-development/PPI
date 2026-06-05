'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Button, Input, Badge } from '@/components/ui'
import { User, Mail, Phone, Building, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

interface Profile {
  id: string
  email: string
  fullName: string | null
  phone: string | null
  company: string | null
}

// Notification preference flag keys — must match API + Prisma columns
type PrefKey = 'emailOrderConfirmations' | 'emailServiceRequests' | 'emailMarketing'

interface Prefs {
  emailOrderConfirmations: boolean
  emailServiceRequests: boolean
  emailMarketing: boolean
}

// Defaults mirror Prisma schema defaults (preserves current send-everything behavior on first load)
const DEFAULT_PREFS: Prefs = {
  emailOrderConfirmations: true,
  emailServiceRequests: true,
  emailMarketing: false,
}

export default function ProfilePage() {
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    company: '',
  })

  // Notification preferences state — hydrated from /api/profile, save-on-toggle
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [savingPref, setSavingPref] = useState<PrefKey | null>(null)
  const [prefBanner, setPrefBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch('/api/profile')
        if (res.ok) {
          const data = await res.json()
          setProfile(data.profile)
          setFormData({
            fullName: data.profile.fullName || '',
            email: data.profile.email || '',
            phone: data.profile.phone || '',
            company: data.profile.company || '',
          })
          // Hydrate prefs defensively — schema columns may be absent on older deploys
          setPrefs({
            emailOrderConfirmations:
              typeof data.profile.emailOrderConfirmations === 'boolean'
                ? data.profile.emailOrderConfirmations
                : DEFAULT_PREFS.emailOrderConfirmations,
            emailServiceRequests:
              typeof data.profile.emailServiceRequests === 'boolean'
                ? data.profile.emailServiceRequests
                : DEFAULT_PREFS.emailServiceRequests,
            emailMarketing:
              typeof data.profile.emailMarketing === 'boolean'
                ? data.profile.emailMarketing
                : DEFAULT_PREFS.emailMarketing,
          })
        }
      } catch (error) {
        console.error('Error fetching profile:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [])

  // Auto-dismiss the pref banner after a few seconds so it doesn't linger
  useEffect(() => {
    if (!prefBanner) return
    const t = setTimeout(() => setPrefBanner(null), 3500)
    return () => clearTimeout(t)
  }, [prefBanner])

  async function togglePref(key: PrefKey, next: boolean) {
    // Per-row in-flight guard — ignore double-clicks while a save is mid-flight
    if (savingPref === key) return
    const prev = prefs[key]
    setPrefs((p) => ({ ...p, [key]: next })) // optimistic
    setSavingPref(key)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      })
      if (!res.ok) throw new Error('save failed')
      setPrefBanner({ kind: 'success', text: 'Preference saved' })
    } catch (err) {
      console.error('Error saving preference:', err)
      setPrefs((p) => ({ ...p, [key]: prev })) // rollback
      setPrefBanner({ kind: 'error', text: 'Could not save — please try again' })
    } finally {
      setSavingPref(null)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: formData.fullName,
          phone: formData.phone,
          company: formData.company,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setProfile(data.profile)
        setIsEditing(false)
      }
    } catch (error) {
      console.error('Error saving profile:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      fullName: profile?.fullName || '',
      email: profile?.email || '',
      phone: profile?.phone || '',
      company: profile?.company || '',
    })
    setIsEditing(false)
  }

  if (loading) {
    return (
      <div>
        <Header title="Profile" />
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header title="Profile" />

      <div className="p-6 max-w-3xl">
        {/* Profile Information */}
        <Card variant="bordered">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">
                Profile Information
              </h2>
              {!isEditing && (
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                  Edit Profile
                </Button>
              )}
            </div>

            <div className="space-y-4">
              <Input
                label="Full Name"
                icon={<User className="w-5 h-5" />}
                value={formData.fullName}
                onChange={(e) =>
                  setFormData({ ...formData, fullName: e.target.value })
                }
                disabled={!isEditing}
              />

              <Input
                label="Email Address"
                type="email"
                icon={<Mail className="w-5 h-5" />}
                value={formData.email}
                disabled
                helperText="Email cannot be changed"
              />

              <Input
                label="Phone Number"
                type="tel"
                icon={<Phone className="w-5 h-5" />}
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                disabled={!isEditing}
                placeholder="(555) 555-5555"
              />

              <Input
                label="Company / Brokerage"
                icon={<Building className="w-5 h-5" />}
                value={formData.company}
                onChange={(e) =>
                  setFormData({ ...formData, company: e.target.value })
                }
                disabled={!isEditing}
                placeholder="Your brokerage name"
              />
            </div>

            {isEditing && (
              <div className="flex gap-4 mt-6">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
                <Button variant="outline" onClick={handleCancel} disabled={saving}>
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notification Preferences */}
        <Card variant="bordered" className="mt-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900">
                Notification Preferences
              </h2>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Changes save automatically. Transactional security emails
              (password resets) cannot be disabled.
            </p>

            {prefBanner && (
              <div
                role="status"
                className={
                  'flex items-center gap-2 px-3 py-2 mb-4 rounded-md text-sm ' +
                  (prefBanner.kind === 'success'
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200')
                }
              >
                {prefBanner.kind === 'success' ? (
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                )}
                <span>{prefBanner.text}</span>
              </div>
            )}

            <div className="space-y-1">
              <PrefRow
                checked={prefs.emailOrderConfirmations}
                saving={savingPref === 'emailOrderConfirmations'}
                onChange={(v) => togglePref('emailOrderConfirmations', v)}
                label="Email notifications for new orders"
                description="Order confirmations, refund receipts, installation-complete emails."
              />

              {/* SMS row — disabled placeholder. No Twilio integration yet (no flag persisted). */}
              <PrefRow
                checked={false}
                saving={false}
                onChange={() => {}}
                disabled
                label="SMS notifications for installation updates"
                description="Text messages when your installer arrives and finishes."
                badge={<Badge variant="neutral">Coming soon</Badge>}
              />

              <PrefRow
                checked={prefs.emailServiceRequests}
                saving={savingPref === 'emailServiceRequests'}
                onChange={(v) => togglePref('emailServiceRequests', v)}
                label="Email notifications for service requests"
                description="Confirmations, status updates, and completion notices."
              />

              <PrefRow
                checked={prefs.emailMarketing}
                saving={savingPref === 'emailMarketing'}
                onChange={(v) => togglePref('emailMarketing', v)}
                label="Marketing emails and promotions"
                description="Occasional product news and promos. Off by default."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Single notification preference row — checkbox + label + description + optional badge + saving spinner
function PrefRow({
  checked,
  saving,
  onChange,
  label,
  description,
  disabled,
  badge,
}: {
  checked: boolean
  saving: boolean
  onChange: (next: boolean) => void
  label: string
  description: string
  disabled?: boolean
  badge?: React.ReactNode
}) {
  return (
    <label
      className={
        'flex items-start gap-3 py-3 border-b border-gray-100 last:border-b-0 ' +
        (disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')
      }
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled || saving}
        className="mt-0.5 rounded border-gray-300 text-pink-500 focus:ring-pink-500 w-5 h-5 disabled:opacity-50"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-900 font-medium">{label}</span>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-pink-500" />}
          {badge}
        </div>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
    </label>
  )
}
