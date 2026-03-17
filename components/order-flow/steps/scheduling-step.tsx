'use client'

import { Zap, Calendar, Clock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'

/**
 * Get the current time in EST/EDT timezone.
 * Returns { hours, dayOfWeek } where dayOfWeek: 0=Sun, 6=Sat
 */
function getEasternTime() {
  const now = new Date()
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return {
    hours: eastern.getHours(),
    dayOfWeek: eastern.getDay(),
    date: eastern,
  }
}

/**
 * Get the next available business day (skips Sundays).
 * If after 4pm EST, pushes one additional day.
 */
function getNextAvailableDate(): Date {
  const { hours, date: easternNow } = getEasternTime()
  const isAfter4pm = hours >= 16

  // Start from tomorrow
  const next = new Date(easternNow)
  next.setDate(next.getDate() + 1)

  // If after 4pm, push one more day
  if (isAfter4pm) {
    next.setDate(next.getDate() + 1)
  }

  // Skip Sunday (0)
  if (next.getDay() === 0) {
    next.setDate(next.getDate() + 1)
  }

  return next
}

function toDateStr(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function SchedulingStep({ formData, updateFormData }: StepProps) {
  const { hours } = getEasternTime()
  const isAfter4pm = hours >= 16

  const nextAvailable = getNextAvailableDate()
  const minDateStr = toDateStr(nextAvailable)

  // Same day only available before 4pm EST
  const canExpedite = !isAfter4pm

  // If user had expedited selected but it's now after 4pm, reset
  if (formData.schedule_type === 'expedited' && !canExpedite) {
    updateFormData({ schedule_type: 'next_available', requested_date: undefined })
  }

  // Validate that selected date isn't a Sunday
  const handleDateChange = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const selected = new Date(year, month - 1, day)
    if (selected.getDay() === 0) {
      // Skip to Monday
      selected.setDate(selected.getDate() + 1)
      updateFormData({ requested_date: toDateStr(selected) })
    } else {
      updateFormData({ requested_date: dateStr })
    }
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
                ? 'Orders placed after 4pm will be installed the following business day.'
                : 'Orders placed before 4pm are installed next business day!'
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
            <p className="text-xs text-gray-500 mt-2">
              Sundays are not available for installation.
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
          <strong>Note:</strong> Same day installations are subject to availability and our current schedule.
          We&apos;ll contact you to confirm if same day service is possible.
        </div>
      )}

      {/* Scheduling disclaimer */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-blue-600 mt-0.5" />
        <div className="space-y-1">
          <p>Next day install orders must be placed before 4pm EST. Orders placed after 4pm EST will be installed the following business day unless rush request is processed.</p>
          <p>We are closed on Sunday.</p>
        </div>
      </div>
    </div>
  )
}
