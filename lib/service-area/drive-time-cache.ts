/**
 * Drive-time cache helpers (Round 25). Two-layer cache:
 *  - ZipDriveTimeCache, keyed by (zip, centerId), seeded in bulk.
 *  - AddressDriveTimeCache, keyed by (addressHash, centerId), filled
 *    on-demand at order POST time when the ZIP estimate is borderline.
 *
 * Both layers respect Google's 30-day freshness rule per the Maps
 * Service Terms. CACHE_TTL_DAYS is the single source of truth — bump
 * it here and both the resolver and the seed script pick it up.
 */

import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// Narrowed catch helper. We only want to swallow the unique-constraint
// race (P2002 == Postgres 23505) — every other error (DB down, schema
// drift, permissions) needs to bubble up so ops notices. The cache layer
// re-throws non-race errors but logs a warning first so the resolver
// stack still has the request context in logs.
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export const CACHE_TTL_DAYS = 30
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000

function isFresh(cachedAt: Date): boolean {
  return Date.now() - cachedAt.getTime() < CACHE_TTL_MS
}

// SHA-256 hash of the normalized address used as the AddressDriveTimeCache
// key. Normalization: lowercase, collapse internal whitespace, strip
// surrounding whitespace. Components are joined with '|' so "1 Main St"
// in city "Lex" doesn't collide with "1" / "Main St Lex" by accident.
export function hashAddress(parts: {
  street: string
  city: string
  state: string
  zip: string
}): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const joined = [parts.street, parts.city, parts.state, parts.zip].map(norm).join('|')
  return createHash('sha256').update(joined).digest('hex')
}

export interface CachedDriveTime {
  driveMinutes: number
  /** Road miles for the same route, or null on rows cached before mile-based
   *  pricing shipped. The resolver treats null as a MISS and re-fetches — a
   *  null must never be read as "0 miles", which would price every stale row
   *  as inside the free radius. */
  driveMiles: number | null
  source: string
  cachedAt: Date
}

/** Prisma Decimal | number | null -> number | null, without importing Decimal. */
function milesToNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number((v as { toString(): string }).toString())
  return Number.isFinite(n) ? n : null
}

export async function readZipDriveTime(zip: string, centerId: string): Promise<CachedDriveTime | null> {
  const row = await prisma.zipDriveTimeCache.findUnique({
    where: { zip_centerId: { zip, centerId } },
  })
  if (!row || !isFresh(row.cachedAt)) return null
  return {
    driveMinutes: row.driveMinutes,
    driveMiles: milesToNum((row as { driveMiles?: unknown }).driveMiles),
    source: row.source,
    cachedAt: row.cachedAt,
  }
}

export async function writeZipDriveTime(
  zip: string,
  centerId: string,
  driveMinutes: number,
  source = 'google_routes',
  driveMiles: number | null = null
): Promise<void> {
  // Cache writes are best-effort — never fail the checkout because we
  // couldn't cache. Race-safety: two concurrent POSTs for the same address
  // can both miss the cache, fetch Google, and arrive here. Postgres
  // ON CONFLICT in the generated upsert is atomic, but P2002 (Postgres
  // 23505) can still bubble up from a different code path; we swallow it
  // silently. Other errors get logged at error level (so they surface in
  // Sentry/Datadog) but still swallowed so the order completes.
  try {
    await prisma.zipDriveTimeCache.upsert({
      where: { zip_centerId: { zip, centerId } },
      create: { zip, centerId, driveMinutes, source, driveMiles },
      // Never overwrite a known mileage with null — a caller that only has
      // minutes (the legacy seed script) must not wipe a good measurement.
      update: { driveMinutes, source, cachedAt: new Date(), ...(driveMiles != null ? { driveMiles } : {}) },
    })
  } catch (err) {
    if (isUniqueViolation(err)) return
    console.error('[drive-time-cache] zip upsert failed (non-fatal, order will proceed)', { zip, centerId, err })
  }
}

export async function readAddressDriveTime(
  addressHash: string,
  centerId: string
): Promise<CachedDriveTime | null> {
  const row = await prisma.addressDriveTimeCache.findUnique({
    where: { addressHash_centerId: { addressHash, centerId } },
  })
  if (!row || !isFresh(row.cachedAt)) return null
  return {
    driveMinutes: row.driveMinutes,
    driveMiles: milesToNum((row as { driveMiles?: unknown }).driveMiles),
    source: row.source,
    cachedAt: row.cachedAt,
  }
}

export async function writeAddressDriveTime(
  addressHash: string,
  centerId: string,
  address: string,
  driveMinutes: number,
  source = 'google_routes',
  driveMiles: number | null = null
): Promise<void> {
  // Same best-effort + non-fatal rationale as writeZipDriveTime above.
  try {
    await prisma.addressDriveTimeCache.upsert({
      where: { addressHash_centerId: { addressHash, centerId } },
      create: { addressHash, centerId, address, driveMinutes, source, driveMiles },
      // See writeZipDriveTime — a null mileage never clobbers a known one.
      update: { driveMinutes, source, address, cachedAt: new Date(), ...(driveMiles != null ? { driveMiles } : {}) },
    })
  } catch (err) {
    if (isUniqueViolation(err)) return
    console.error('[drive-time-cache] address upsert failed (non-fatal, order will proceed)', { addressHash, centerId, err })
  }
}
