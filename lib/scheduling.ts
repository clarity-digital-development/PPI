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

/**
 * Returns the Unix-millis instant for Eastern-time midnight at the start of
 * the calendar day that `at` falls on (in Eastern time). Used by the cancel
 * route's 24h cutoff so customers don't lose hours of their window to
 * UTC-vs-ET drift.
 *
 * Implementation note: Date constructor doesn't accept a timezone arg, so we
 * iteratively probe to find the UTC millis that lands on the right ET-day at
 * 00:00. The iteration is at most 2-3 hops (initial guess is offset-based).
 */
export function easternMidnightMs(at: Date): number {
  // Get the ET wall-clock for this instant.
  const etString = at.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  // en-US locale: "MM/DD/YYYY"
  const match = etString.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return at.getTime() // fall back — shouldn't happen
  const [, mm, dd, yyyy] = match
  // Construct a UTC instant for ET midnight by binary-search-ish: try both
  // common offsets (5h for EST, 4h for EDT), pick the one whose ET projection
  // matches the target day.
  const target = `${yyyy}-${mm}-${dd}`
  for (const offsetHours of [5, 4]) {
    const candidate = Date.UTC(
      parseInt(yyyy, 10),
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      offsetHours, 0, 0, 0,
    )
    const projected = new Date(candidate).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    // Want target day AND hour=00
    if (projected.startsWith(`${mm}/${dd}/${yyyy}`) && projected.includes(' 00:')) {
      return candidate
    }
  }
  // Fallback: 5h offset (EST) — the older offset.
  return Date.UTC(
    parseInt(yyyy, 10),
    parseInt(mm, 10) - 1,
    parseInt(dd, 10),
    5, 0, 0, 0,
  )
}

export interface SchedulingValidationOk {
  ok: true
}
export interface SchedulingValidationErr {
  ok: false
  /** Customer-facing message. */
  error: string
  /** Stable code for branching in the client. */
  code: 'invalid_date_format' | 'sunday_closed' | 'before_cutoff' | 'expedite_unavailable'
}

/**
 * Server-side gate for an order's requested install date.
 *
 * The wizard's <input type="date" min={...}> is purely client-side decoration —
 * a customer with dev tools (or a stale tab from earlier in the day) can submit
 * any date. EVERY write endpoint that accepts a schedule must call this.
 *
 * Rules (mirror the business rules used by the wizard):
 *   - Expedited (same-day) is only allowed BEFORE 4pm Eastern.
 *   - A specific requested_date must be ≥ getNextAvailableDate() and not Sunday.
 *   - "Next available" with no requested_date is always OK — server computes
 *     the date downstream.
 */
export function validateScheduling(args: {
  requestedDate?: string | null
  isExpedited?: boolean
}): SchedulingValidationOk | SchedulingValidationErr {
  const isExpedited = !!args.isExpedited

  // Expedited adds an ADDITIONAL same-day-cutoff constraint; it is NOT a
  // bypass of the date check. If isExpedited is true and a requestedDate
  // is also supplied, BOTH must pass. (Adversarial review caught this:
  // expedited:true with a past requestedDate used to silently slip
  // through and persist a past Order.scheduledDate.)
  if (isExpedited && !canExpediteNow()) {
    return {
      ok: false,
      code: 'expedite_unavailable',
      error: 'Same-day service is unavailable after 4pm Eastern. Please pick a future date.',
    }
  }

  if (!args.requestedDate) {
    // No specific date — either expedited (which we just validated) or
    // next-available (server computes downstream). Nothing more to check.
    return { ok: true }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.requestedDate)) {
    return { ok: false, code: 'invalid_date_format', error: 'Invalid date format (expected YYYY-MM-DD).' }
  }

  if (isSunday(args.requestedDate)) {
    return {
      ok: false,
      code: 'sunday_closed',
      error: 'We are closed on Sundays — please pick another day.',
    }
  }

  // For expedited, "today" is the only valid date — the wizard sets
  // requested_date to today's Eastern date alongside isExpedited:true.
  // For non-expedited, the earliest valid date is getNextAvailableDate()
  // (tomorrow, or day-after-tomorrow if past 4pm ET).
  const easternToday = toDateStr(getEasternTime().date)
  const minDate = isExpedited ? easternToday : toDateStr(getNextAvailableDate())
  if (args.requestedDate < minDate) {
    return {
      ok: false,
      code: 'before_cutoff',
      error: `Earliest available install date is ${minDate}. The 4pm Eastern cutoff has passed for earlier dates.`,
    }
  }

  return { ok: true }
}
