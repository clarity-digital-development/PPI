import { NextRequest, NextResponse } from 'next/server'

interface RateLimitEntry {
  count: number
  resetTime: number
}

// In-memory store for rate limiting (works for single-instance deployments)
// For multi-instance/serverless, use Redis or similar
const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now()
  rateLimitStore.forEach((entry, key) => {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key)
    }
  })
}, 60000) // Clean up every minute

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
  message?: string // Custom error message
}

const defaultConfig: RateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  message: 'Too many requests, please try again later',
}

/**
 * Rate limit configuration presets
 */
export const rateLimitPresets = {
  // Strict: for login/register - 5 attempts per 15 minutes
  auth: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
  },
  // Moderate: for password reset - 3 attempts per hour
  passwordReset: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 3,
    message: 'Too many password reset attempts. Please try again later.',
  },
  // Standard: for general API - 100 requests per 15 minutes
  api: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
    message: 'Rate limit exceeded. Please slow down.',
  },
  // Address-aware service-area quote: with a full address present this can
  // trigger a live (billed) Google Routes call per active ServiceCenter, and
  // the client-side 300ms debounce is trivially bypassed by a direct request
  // — cap it generously above normal form-filling usage but well below a
  // scripted-hammering rate. 20/min per IP+route.
  serviceAreaQuote: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: 'Too many address lookups. Please slow down and try again in a moment.',
  },
} as const

/**
 * Get client identifier from request
 */
function getClientId(request: NextRequest): string {
  // Try to get real IP from various headers (for proxied requests)
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const cfConnectingIp = request.headers.get('cf-connecting-ip')

  // Use the first available IP, fallback to a default
  const ip = cfConnectingIp || realIp || forwardedFor?.split(',')[0]?.trim() || 'unknown'

  return ip
}

/**
 * Check rate limit for a request
 * Returns null if allowed, or a NextResponse if rate limited
 */
export function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig = defaultConfig
): NextResponse | null {
  const clientId = getClientId(request)
  const key = `${clientId}:${request.nextUrl.pathname}`
  const now = Date.now()

  const entry = rateLimitStore.get(key)

  if (!entry || entry.resetTime < now) {
    // First request or window expired - create new entry
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    })
    return null
  }

  if (entry.count >= config.maxRequests) {
    // Rate limit exceeded
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000)

    return NextResponse.json(
      { error: config.message },
      {
        status: 429,
        headers: {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': entry.resetTime.toString(),
        },
      }
    )
  }

  // Increment counter
  entry.count++
  rateLimitStore.set(key, entry)

  return null
}

/**
 * Higher-order function to wrap an API handler with rate limiting
 */
export function withRateLimit<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T,
  config: RateLimitConfig = defaultConfig
) {
  return async (request: NextRequest, ...args: any[]): Promise<NextResponse> => {
    const rateLimitResponse = checkRateLimit(request, config)
    if (rateLimitResponse) {
      return rateLimitResponse
    }
    return handler(request, ...args)
  }
}

/**
 * Track failed login attempts for account lockout
 */
const failedAttempts = new Map<string, { count: number; lockoutUntil: number }>()

export function trackFailedLogin(email: string): void {
  const key = email.toLowerCase()
  const now = Date.now()
  const entry = failedAttempts.get(key)

  if (!entry || entry.lockoutUntil < now) {
    failedAttempts.set(key, { count: 1, lockoutUntil: 0 })
  } else {
    entry.count++
    // Lock account after 5 failed attempts for 15 minutes
    if (entry.count >= 5) {
      entry.lockoutUntil = now + 15 * 60 * 1000
    }
    failedAttempts.set(key, entry)
  }
}

export function clearFailedLogins(email: string): void {
  failedAttempts.delete(email.toLowerCase())
}

export function isAccountLocked(email: string): boolean {
  const key = email.toLowerCase()
  const entry = failedAttempts.get(key)

  if (!entry) return false
  if (entry.lockoutUntil < Date.now()) {
    // Lockout expired, clear it
    failedAttempts.delete(key)
    return false
  }

  return entry.lockoutUntil > Date.now()
}

export function getLockoutTimeRemaining(email: string): number {
  const key = email.toLowerCase()
  const entry = failedAttempts.get(key)

  if (!entry || entry.lockoutUntil < Date.now()) return 0

  return Math.ceil((entry.lockoutUntil - Date.now()) / 1000)
}
