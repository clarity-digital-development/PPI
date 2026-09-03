'use client'

import { useState } from 'react'
import { Zap, Calendar, Clock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'
// One source of truth for closed days and the 4pm cutoff — this step used
// to carry its own copy of these rules, which silently drifted from the
// server's (Ryan 2026-08-31: Saturdays are now closed too).
import { getEasternTime, getNextAvailableDate, toDateStr, canExpediteNow, closedDayReason } from '@/lib/scheduling'

export function SchedulingStep({ formData, updateFormData }: StepProps) {
  const { hours, date: easternNowDate } = getEasternTime()
  const isAfter4pm = hours >= 16
  const todayClosed = closedDayReason(toDateStr(easternNowDate)) !== null
  const [dateError, setDateError] = useState<string | null>(null)

  const nextAvailable = getNextAvailableDate()
  const minDateStr = toDateStr(nextAvailable)

  // Same day only available before 4pm EST on an open day
  const canExpedite = canExpediteNow()

  // If user had expedited selected but it's now after 4pm, reset
  if (formData.schedule_type === 'expedited' && !canExpedite) {
    updateFormData({ schedule_type: 'next_available', requested_date: undefined })
  }

  // Reject closed days with a visible message instead of silently bumping
  // the date (the old behavior moved Sunday picks to Monday without saying so).
  const handleDateChange = (dateStr: string) => {
    const reason = dateStr ? closedDayReason(dateStr) : null
    if (reason) {
      setDateError(reason)
      return
    }
    setDateError(null)
    updateFormData({ requested_date: dateStr })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Schedule Installation</h2>
        <p className="text-gray-600">When do you need this installed?</p>
      </div>

      <div className="space-y-3">
        {/* Next Available */}
        <button
          type="button"
          onClick={() => updateFormData({
            schedule_type: 'next_available',
            requested_date: undefined
          })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.schedule_type === 'next_available'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.schedule_type === 'next_available' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <Clock className={cn(
              'w-5 h-5',
              formData.schedule_type === 'next_available' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Next available day</h3>
            <p className="text-sm text-gray-600">
              {isAfter4pm
                ? `Since it's after 4pm EST, the earliest install date is ${nextAvailable.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}. (We're closed Saturdays and Sundays.)`
                : `Orders placed before 4pm EST are installed the next business day (${nextAvailable.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}).`
              }
            </p>
            <p className="text-sm text-green-600 font-medium mt-1">
              No additional fee
            </p>
          </div>
        </button>

        {/* Specific Date */}
        <button
          type="button"
          onClick={() => updateFormData({
            schedule_type: 'specific_date',
            requested_date: minDateStr
          })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.schedule_type === 'specific_date'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.schedule_type === 'specific_date' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <Calendar className={cn(
              'w-5 h-5',
              formData.schedule_type === 'specific_date' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Specific date</h3>
            <p className="text-sm text-gray-600">
              Schedule installation for a particular day
            </p>
            <p className="text-sm text-green-600 font-medium mt-1">
              No additional fee
            </p>
          </div>
        </button>

        {formData.schedule_type === 'specific_date' && (
          <div className="ml-14 p-4 bg-gray-50 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Date
            </label>
            <input
              type="date"
              min={minDateStr}
              value={formData.requested_date || ''}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none transition-all"
            />
            {dateError && (
              <p className="text-xs text-red-600 mt-2">{dateError}</p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              We&apos;re closed Saturdays, Sundays, and holidays.
            </p>
          </div>
        )}

        {/* Expedited */}
        <button
          type="button"
          onClick={() => {
            if (canExpedite) {
              updateFormData({
                schedule_type: 'expedited',
                requested_date: undefined
              })
            }
          }}
          disabled={!canExpedite}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            !canExpedite
              ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
              : formData.schedule_type === 'expedited'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            !canExpedite
              ? 'bg-gray-100'
              : formData.schedule_type === 'expedited' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <Zap className={cn(
              'w-5 h-5',
              !canExpedite
                ? 'text-gray-400'
                : formData.schedule_type === 'expedited' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className={cn("font-semibold", canExpedite ? "text-gray-900" : "text-gray-400")}>
              Same day (expedited)
            </h3>
            <p className={cn("text-sm", canExpedite ? "text-gray-600" : "text-gray-400")}>
              {canExpedite
                ? 'Rush installation today, subject to availability'
                : todayClosed
                  ? "Same day service isn't available on days we're closed"
                  : 'Same day service is only available for orders placed before 4pm EST'
              }
            </p>
            {canExpedite && (
              <p className="text-sm font-medium text-pink-600 mt-1">
                + ${PRICING.expedite_fee.toFixed(2)} expedite fee
              </p>
            )}
          </div>
        </button>
      </div>

      {formData.schedule_type === 'expedited' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <strong>Note:</strong> Please contact{' '}
          <a href="tel:8593958188" className="font-semibold underline">859-395-8188</a>{' '}
          to notify us of the rush installation. We&apos;ll confirm if same-day service is possible.
          If it&apos;s not possible, the expedite fee will be refunded.
        </div>
      )}

      {/* Scheduling disclaimer */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-blue-600 mt-0.5" />
        <div className="space-y-1">
          <p>Next day install orders must be placed before 4pm EST. Orders placed after 4pm EST will be installed the following business day unless rush request is processed.</p>
          <p>We are closed Saturday and Sunday.</p>
        </div>
      </div>
    </div>
  )
}
