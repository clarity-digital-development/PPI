/**
 * Seed the ZipDriveTimeCache from Google Routes API (Round 25).
 *
 * Strategy:
 *  - Pull every active ServiceCenter from the DB.
 *  - Iterate KY-region ZIPs from the us-zips dataset (prefix range 400-427
 *    + a haversine prefilter to catch neighbor-state border ZIPs that
 *    Pink Posts actually services).
 *  - For each (zip, center): skip if the cache already has a fresh row;
 *    otherwise call the Routes API and upsert the result.
 *  - Idempotent. Safe to re-run weekly (or whenever the centers change)
 *    — the 30-day TTL plus the fresh-row skip means re-runs only spend
 *    API quota on the rows that genuinely need a refresh.
 *
 * Cost: at PPI's ~2-3 active service centers, expect ~1,500-3,000 elements
 * per full re-seed. Both the legacy Distance Matrix and Routes Compute
 * Route Matrix Essentials SKUs give 10,000 free elements/month, so a
 * full seed fits comfortably inside the free tier as long as you don't
 * run it more than 3x in a single month.
 *
 * Usage:
 *   GOOGLE_MAPS_SERVER_API_KEY=... npx tsx scripts/seed-zip-drive-times.ts
 *   GOOGLE_MAPS_SERVER_API_KEY=... npx tsx scripts/seed-zip-drive-times.ts --dry-run
 *
 * --dry-run reports how many lookups would fire without calling Google.
 */

import zipMap from 'us-zips/object'
import { prisma } from '@/lib/prisma'
import { haversineMiles, estDriveMinutes } from '@/lib/service-area'
import { fetchDriveMinutesByLatLng } from '@/lib/service-area/google-routes'
import { readZipDriveTime, writeZipDriveTime } from '@/lib/service-area/drive-time-cache'

// Past this haversine-estimated drive time we don't seed — those ZIPs
// are confidently out-of-area and a precise Google number doesn't change
// the answer. Saves API quota for the ZIPs that actually matter.
const HAVERSINE_PREFILTER_MINUTES = 120

const KY_ZIP_PREFIXES = Array.from({ length: 28 }, (_, i) => String(400 + i).padStart(3, '0'))

interface CandidateRow {
  zip: string
  lat: number
  lng: number
}

function candidateZips(): CandidateRow[] {
  const out: CandidateRow[] = []
  for (const zip of Object.keys(zipMap)) {
    if (!KY_ZIP_PREFIXES.includes(zip.slice(0, 3))) continue
    const entry = (zipMap as Record<string, { latitude: number; longitude: number }>)[zip]
    out.push({ zip, lat: entry.latitude, lng: entry.longitude })
  }
  return out
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const centers = await prisma.serviceCenter.findMany({ where: { isActive: true } })
  if (centers.length === 0) {
    console.log('No active service centers — nothing to seed.')
    return
  }

  const zips = candidateZips()
  console.log(`Centers: ${centers.length}  |  Candidate ZIPs (KY prefixes 400-427): ${zips.length}`)

  let attempted = 0
  let cached = 0
  let skippedFresh = 0
  let skippedFarOutOfArea = 0
  let failed = 0

  for (const center of centers) {
    const centerLL = { lat: Number(center.lat), lng: Number(center.lng) }
    console.log(`\n--- ${center.name} (${center.id}) ---`)
    for (const z of zips) {
      const havMiles = haversineMiles({ lat: z.lat, lng: z.lng }, centerLL)
      const havMin = estDriveMinutes(havMiles)
      if (havMin > HAVERSINE_PREFILTER_MINUTES) {
        skippedFarOutOfArea++
        continue
      }
      const existing = await readZipDriveTime(z.zip, center.id)
      if (existing) {
        skippedFresh++
        continue
      }
      attempted++
      if (dryRun) {
        console.log(`  [dry-run] would seed ${z.zip} (haversine ${havMin.toFixed(0)}m)`)
        continue
      }
      const live = await fetchDriveMinutesByLatLng({ lat: z.lat, lng: z.lng }, centerLL)
      if (live == null) {
        failed++
        continue
      }
      await writeZipDriveTime(z.zip, center.id, live)
      cached++
      if (cached % 25 === 0) console.log(`  cached ${cached} so far...`)
    }
  }

  console.log('\n=== SEED SUMMARY ===')
  console.log(`Attempted lookups:        ${attempted}`)
  console.log(`Cached this run:          ${cached}`)
  console.log(`Skipped (already fresh):  ${skippedFresh}`)
  console.log(`Skipped (>120m estimate): ${skippedFarOutOfArea}`)
  console.log(`Failed:                   ${failed}`)
  if (dryRun) console.log('(dry-run — no Google API calls made, nothing written)')
}

main()
  .catch((e) => {
    console.error(e)
    // Set exitCode rather than calling process.exit(1) so the .finally()
    // below still runs and prisma's pool is closed cleanly. Node exits
    // naturally with this code once the event loop drains.
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
