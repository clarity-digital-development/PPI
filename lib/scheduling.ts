/**
 * Shared scheduling helpers — used by the order wizard (install scheduling)
 * AND the service-request / removal scheduling modal so the same business
 * rules (no Sundays, no same-day after 4pm EST) apply everywhere.
 */

/** Eastern Time clock components, used to apply business-hour cutoffs. */
export function getEasternTime() {
  const now = new Date()
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return {
    hours: eastern.getHours(),
    dayOfWeek: eastern.getDay(), // 0 = Sun, 6 = Sat
    date: eastern,
  }
}

/**
 * Next bookable business day given current Eastern Time:
 *  - Start from tomorrow
 *  - If it is currently after 4pm Eastern, push one additional day
 *  - Skip Sundays
 */
export function getNextAvailableDate(): Date {
  const { hours, date: easternNow } = getEasternTime()
  const isAfter4pm = hours >= 16

  const next = new Date(easternNow)
  next.setDate(next.getDate() + 1)
  if (isAfter4pm) {
    next.setDate(next.getDate() + 1)
  }
  if (next.getDay() === 0) {
    next.setDate(next.getDate() + 1) // skip Sunday
  }
  return next
}

/** Format a Date as YYYY-MM-DD using local components (for <input type="date">). */
export function toDateStr(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Whether expedited / same-day service can be offered right now.
 * False after 4pm EST so customers can't book a same-day install at 8pm.
 */
export function canExpediteNow(): boolean {
  return getEasternTime().hours < 16
}

/**
 * Returns true if the given YYYY-MM-DD string is a Sunday (we are closed).
 */
export function isSunday(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.getDay() === 0
}
