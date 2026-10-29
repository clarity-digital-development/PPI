'use client'

import { useState } from 'react'
import { Card, CardContent, Button, Badge } from '@/components/ui'
import { CreditCard, Trash2, Star, Loader2, Pencil } from 'lucide-react'

interface PaymentMethod {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
  nickname?: string | null
}

interface PaymentMethodCardProps {
  paymentMethod: PaymentMethod
  onDelete: (id: string) => Promise<void>
  onSetDefault: (id: string) => Promise<void>
  // Saves a nickname ("Ashley's card"); throws to keep the box open.
  onRename?: (id: string, nickname: string) => Promise<void>
}

const brandIcons: Record<string, string> = {
  visa: '💳',
  mastercard: '💳',
  amex: '💳',
  discover: '💳',
  unknown: '💳',
}

const brandColors: Record<string, string> = {
  visa: 'bg-blue-50 border-blue-200',
  mastercard: 'bg-red-50 border-red-200',
  amex: 'bg-green-50 border-green-200',
  discover: 'bg-orange-50 border-orange-200',
  unknown: 'bg-gray-50 border-gray-200',
}

export function PaymentMethodCard({
  paymentMethod,
  onDelete,
  onSetDefault,
  onRename,
}: PaymentMethodCardProps) {
  const [deleting, setDeleting] = useState(false)
  const [settingDefault, setSettingDefault] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState(paymentMethod.nickname ?? '')
  const [savingName, setSavingName] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!onRename || savingName) return
    setSavingName(true)
    setRenameError(null)
    try {
      await onRename(paymentMethod.id, nicknameDraft)
      setRenaming(false)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Couldn't save the nickname.")
    } finally {
      setSavingName(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this payment method?')) {
      return
    }

    setDeleting(true)
    try {
      await onDelete(paymentMethod.id)
    } finally {
      setDeleting(false)
    }
  }

  const handleSetDefault = async () => {
    setSettingDefault(true)
    try {
      await onSetDefault(paymentMethod.id)
    } finally {
      setSettingDefault(false)
    }
  }

  const brandName = paymentMethod.brand.charAt(0).toUpperCase() + paymentMethod.brand.slice(1)

  return (
    <Card className={`${brandColors[paymentMethod.brand] || brandColors.unknown}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
              <CreditCard className="w-5 h-5 text-gray-600" />
            </div>
            <div className="min-w-0">
              {paymentMethod.nickname && !renaming && (
                <p className="font-semibold text-gray-900 truncate">{paymentMethod.nickname}</p>
              )}
              <div className="flex items-center gap-2">
                <span className={paymentMethod.nickname ? 'text-sm text-gray-700' : 'font-medium text-gray-900'}>
                  {brandName} •••• {paymentMethod.last4}
                </span>
                {paymentMethod.isDefault && (
                  <Badge variant="success" className="text-xs">
                    <Star className="w-3 h-3 mr-1" />
                    Default
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-500">
                Expires {paymentMethod.expMonth.toString().padStart(2, '0')}/{paymentMethod.expYear}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRename && !renaming && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNicknameDraft(paymentMethod.nickname ?? '')
                  setRenameError(null)
                  setRenaming(true)
                }}
                className="text-gray-600 hover:text-pink-600"
                aria-label="Name this card"
                title="Name this card"
              >
                <Pencil className="w-4 h-4" />
              </Button>
            )}
            {!paymentMethod.isDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSetDefault}
                disabled={settingDefault}
                className="text-gray-600 hover:text-pink-600"
              >
                {settingDefault ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Star className="w-4 h-4" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="text-gray-600 hover:text-red-600"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
        {renaming && (
          <form onSubmit={handleSaveName} className="mt-3 space-y-2">
            <label htmlFor={`nickname-${paymentMethod.id}`} className="block text-sm font-medium text-gray-700">
              Card nickname
            </label>
            <input
              id={`nickname-${paymentMethod.id}`}
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              maxLength={40}
              placeholder="e.g. Ashley's card"
              autoFocus
              disabled={savingName}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            {renameError && <p className="text-sm text-red-600">{renameError}</p>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)} disabled={savingName}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={savingName}>
                {savingName ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
