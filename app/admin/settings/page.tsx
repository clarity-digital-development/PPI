'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, Button, Badge, Input } from '@/components/ui'
import {
  Settings,
  CreditCard,
  Bell,
  Users,
  CheckCircle,
  XCircle,
  Send,
  Loader2,
  Tag,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'

interface EmailConfig {
  resendConfigured: boolean
  adminEmail: string | null
  fromEmail: string
}

interface PromoCode {
  id: string
  code: string
  description: string | null
  discountType: 'percentage' | 'fixed'
  discountValue: number
  minOrderAmount: number | null
  maxUses: number | null // Max uses per customer
  startsAt: string | null
  expiresAt: string | null
  isActive: boolean
  _count?: { orders: number; usages: number }
}

export default function AdminSettingsPage() {
  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null)
  const [loadingEmail, setLoadingEmail] = useState(true)
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Promo code state
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([])
  const [loadingPromos, setLoadingPromos] = useState(true)
  const [showAddPromo, setShowAddPromo] = useState(false)
  const [savingPromo, setSavingPromo] = useState(false)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [newPromo, setNewPromo] = useState({
    code: '',
    description: '',
    discountType: 'percentage' as 'percentage' | 'fixed',
    discountValue: '',
    maxUses: '',
    expiresAt: '',
    waiveFuelSurcharge: false,
  })

  useEffect(() => {
    async function fetchEmailConfig() {
      try {
        const res = await fetch('/api/admin/settings/email')
        if (res.ok) {
          const data = await res.json()
          setEmailConfig(data)
        }
      } catch (error) {
        console.error('Error fetching email config:', error)
      } finally {
        setLoadingEmail(false)
      }
    }
    fetchEmailConfig()
  }, [])

  useEffect(() => {
    async function fetchPromoCodes() {
      try {
        const res = await fetch('/api/admin/promo-codes')
        if (res.ok) {
          const data = await res.json()
          setPromoCodes(data.promoCodes)
        }
      } catch (error) {
        console.error('Error fetching promo codes:', error)
      } finally {
        setLoadingPromos(false)
      }
    }
    fetchPromoCodes()
  }, [])

  const handleCreatePromo = async () => {
    if (!newPromo.code || !newPromo.discountValue) {
      setPromoError('Code and discount value are required')
      return
    }

    setSavingPromo(true)
    setPromoError(null)

    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newPromo.code,
          description: newPromo.description || null,
          discountType: newPromo.discountType,
          discountValue: parseFloat(newPromo.discountValue),
          maxUses: newPromo.maxUses ? parseInt(newPromo.maxUses) : null,
          expiresAt: newPromo.expiresAt ? new Date(newPromo.expiresAt).toISOString() : null,
          waiveFuelSurcharge: newPromo.waiveFuelSurcharge,
          isActive: true,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setPromoCodes((prev) => [data.promoCode, ...prev])
        setShowAddPromo(false)
        setNewPromo({
          code: '',
          description: '',
          discountType: 'percentage',
          discountValue: '',
          maxUses: '',
          expiresAt: '',
          waiveFuelSurcharge: false,
        })
      } else {
        const data = await res.json()
        setPromoError(data.error || 'Failed to create promo code')
      }
    } catch (error) {
      setPromoError('Failed to create promo code')
    } finally {
      setSavingPromo(false)
    }
  }

  const handleTogglePromo = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })

      if (res.ok) {
        setPromoCodes((prev) =>
          prev.map((p) => (p.id === id ? { ...p, isActive: !isActive } : p))
        )
      }
    } catch (error) {
      console.error('Error toggling promo code:', error)
    }
  }

  const handleDeletePromo = async (id: string) => {
    if (!confirm('Are you sure you want to delete this promo code?')) return

    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setPromoCodes((prev) => prev.filter((p) => p.id !== id))
      }
    } catch (error) {
      console.error('Error deleting promo code:', error)
    }
  }

  const sendTestEmail = async () => {
    setSendingTest(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/settings/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const data = await res.json()
      if (res.ok) {
        setTestResult({ success: true, message: data.message })
      } else {
        setTestResult({ success: false, message: data.error })
      }
    } catch (error) {
      setTestResult({ success: false, message: 'Failed to send test email' })
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600">Manage your business settings</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Payment Settings */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-pink-600" />
              </div>
              <h2 className="font-semibold text-gray-900">Payment Settings</h2>
            </div>
            <p className="text-gray-600 text-sm mb-4">
              Configure Stripe integration and payment options.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Stripe Integration</span>
                <Badge variant="success">Configured</Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Webhook</span>
                <Badge variant="success">Active</Badge>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">
              Update STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in deployment settings.
            </p>
          </CardContent>
        </Card>

        {/* Email Notifications */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Bell className="w-5 h-5 text-blue-600" />
              </div>
              <h2 className="font-semibold text-gray-900">Email Notifications</h2>
            </div>
            <p className="text-gray-600 text-sm mb-4">
              Configure email notifications for orders and alerts.
            </p>

            {loadingEmail ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : emailConfig ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Resend API</span>
                  {emailConfig.resendConfigured ? (
                    <Badge variant="success">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Configured
                    </Badge>
                  ) : (
                    <Badge variant="error">
                      <XCircle className="w-3 h-3 mr-1" />
                      Not Configured
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Admin Email</span>
                  <span className="text-gray-900 font-medium">
                    {emailConfig.adminEmail || 'Not set'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">From Address</span>
                  <span className="text-gray-900 font-medium text-xs">
                    {emailConfig.fromEmail}
                  </span>
                </div>

                {emailConfig.resendConfigured && emailConfig.adminEmail && (
                  <div className="pt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={sendTestEmail}
                      disabled={sendingTest}
                      className="w-full"
                    >
                      {sendingTest ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Send Test Email
                        </>
                      )}
                    </Button>
                    {testResult && (
                      <div
                        className={`mt-2 p-2 rounded text-xs ${
                          testResult.success
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {testResult.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Failed to load email configuration</p>
            )}
          </CardContent>
        </Card>

        {/* Business Settings */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Settings className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="font-semibold text-gray-900">Business Settings</h2>
            </div>
            <p className="text-gray-600 text-sm mb-4">
              Configure pricing, service areas, and business rules.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Fuel Surcharge</span>
                <span className="font-semibold text-gray-900">$3.49</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Expedite Fee</span>
                <span className="font-semibold text-gray-900">$50.00</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Rider Install</span>
                <span className="font-semibold text-gray-900">$2.00</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Rider Rental</span>
                <span className="font-semibold text-gray-900">$5.00</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Sales Tax</span>
                <span className="font-semibold text-gray-900">6%</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-gray-600">Service Area</span>
                <span className="font-semibold text-gray-900">Kentucky, Ohio</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Admin Users */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <h2 className="font-semibold text-gray-900">Admin Users</h2>
            </div>
            <p className="text-gray-600 text-sm mb-4">
              Manage admin access and permissions.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-gray-600">Admin Role</span>
                <Badge variant="info">Database Managed</Badge>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">
              To add admin users, update the role field in the users table to &apos;admin&apos;
              via Prisma Studio: <code className="bg-gray-100 px-1 rounded">npx prisma studio</code>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Promo Codes Section - Full Width */}
      <div className="mt-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                  <Tag className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">Promo Codes</h2>
                  <p className="text-gray-600 text-sm">Manage promotional discount codes</p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => setShowAddPromo(!showAddPromo)}
                className="bg-pink-600 hover:bg-pink-700"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Code
              </Button>
            </div>

            {/* Add Promo Form */}
            {showAddPromo && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h3 className="font-medium text-gray-900 mb-3">Create New Promo Code</h3>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Code *
                    </label>
                    <Input
                      value={newPromo.code}
                      onChange={(e) =>
                        setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })
                      }
                      placeholder="e.g., WELCOME10"
                      className="uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Discount Type
                    </label>
                    <select
                      value={newPromo.discountType}
                      onChange={(e) =>
                        setNewPromo({
                          ...newPromo,
                          discountType: e.target.value as 'percentage' | 'fixed',
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed Amount ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Discount Value *
                    </label>
                    <Input
                      type="number"
                      value={newPromo.discountValue}
                      onChange={(e) =>
                        setNewPromo({ ...newPromo, discountValue: e.target.value })
                      }
                      placeholder={newPromo.discountType === 'percentage' ? '10' : '5.00'}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <Input
                      value={newPromo.description}
                      onChange={(e) =>
                        setNewPromo({ ...newPromo, description: e.target.value })
                      }
                      placeholder="e.g., First order discount"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Uses Per Customer (optional)
                    </label>
                    <Input
                      type="number"
                      value={newPromo.maxUses}
                      onChange={(e) =>
                        setNewPromo({ ...newPromo, maxUses: e.target.value })
                      }
                      placeholder="Unlimited"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Expires (optional)
                    </label>
                    <Input
                      type="date"
                      value={newPromo.expiresAt}
                      onChange={(e) =>
                        setNewPromo({ ...newPromo, expiresAt: e.target.value })
                      }
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPromo.waiveFuelSurcharge}
                    onChange={(e) =>
                      setNewPromo({ ...newPromo, waiveFuelSurcharge: e.target.checked })
                    }
                    className="w-4 h-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500"
                  />
                  <span className="text-sm text-gray-700">Waive fuel surcharge ($3.49)</span>
                </label>
                {promoError && (
                  <p className="text-red-600 text-sm mt-2">{promoError}</p>
                )}
                <div className="flex gap-2 mt-4">
                  <Button
                    size="sm"
                    onClick={handleCreatePromo}
                    disabled={savingPromo}
                    className="bg-pink-600 hover:bg-pink-700"
                  >
                    {savingPromo ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Code'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddPromo(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Promo Codes List */}
            {loadingPromos ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : promoCodes.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">
                No promo codes yet. Click &quot;Add Code&quot; to create one.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Code</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Discount</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Uses</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Expires</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promoCodes.map((promo) => (
                      <tr key={promo.id} className="border-b border-gray-100">
                        <td className="py-3 px-2">
                          <div>
                            <span className="font-mono font-semibold text-gray-900">
                              {promo.code}
                            </span>
                            {promo.description && (
                              <p className="text-xs text-gray-500">{promo.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <span className="font-medium text-gray-900">
                            {promo.discountType === 'percentage'
                              ? `${promo.discountValue}%`
                              : `$${Number(promo.discountValue).toFixed(2)}`}
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          <span className="text-gray-600">
                            {promo._count?.orders || 0} orders
                            {promo.maxUses && (
                              <span className="text-gray-400 text-xs ml-1">
                                (max {promo.maxUses}/customer)
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          {promo.expiresAt ? (
                            <span
                              className={
                                new Date(promo.expiresAt) < new Date()
                                  ? 'text-red-600'
                                  : 'text-gray-600'
                              }
                            >
                              {new Date(promo.expiresAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-gray-400">Never</span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          {promo.isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="neutral">Inactive</Badge>
                          )}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleTogglePromo(promo.id, promo.isActive)}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                              title={promo.isActive ? 'Deactivate' : 'Activate'}
                            >
                              {promo.isActive ? (
                                <ToggleRight className="w-5 h-5 text-green-600" />
                              ) : (
                                <ToggleLeft className="w-5 h-5" />
                              )}
                            </button>
                            <button
                              onClick={() => handleDeletePromo(promo.id)}
                              className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
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
      </div>
    </div>
  )
}
