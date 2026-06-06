/**
 * One-time seed for the five Pink Posts service centers per Ryan's
 * 2026-06-02 spec. Idempotent — uses `upsert` on the unique `name`
 * column so reruns are safe. Lat/lng are city-center coords (Census /
 * Wikipedia geographic centers); Ryan can edit individual shop
 * coordinates from the Admin > Service Areas page once exact shop
 * addresses arrive.
 *
 * Drive-time bands (per Ryan):
 *   Lexington      standard <=  45min   surcharge <= 1h 45min (105 min)
 *   Cincinnati     standard <=  60min   surcharge <= 1h 30min (90  min)
 *   Elizabethtown  standard <=  30min   surcharge <= 1h       (60  min)
 *   Louisville     standard <=  45min   surcharge <= 1h 30min (90  min)
 *   Bardstown      standard <=  30min   surcharge <= 1h       (60  min)
 *
 * All centers share: surchargeCents=5000 ($50), contactPhone=859-395-8188,
 * isActive=true.
 *
 *   npx tsx scripts/_seed-service-centers.ts
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

// WHY: load .env.local then .env so DATABASE_URL is available without dotenv dep.
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set. Aborting.')
  process.exit(1)
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString })),
})

interface CenterSeed {
  name: string
  addressLine: string | null
  city: string
  state: string
  zip: string
  lat: number
  lng: number
  standardMinutes: number
  surchargeMinutes: number
}

const CENTERS: CenterSeed[] = [
  {
    name: 'Lexington',
    addressLine: null,
    city: 'Lexington',
    state: 'KY',
    zip: '40507',
    lat: 38.040600,
    lng: -84.503700,
    standardMinutes: 45,
    surchargeMinutes: 105,
  },
  {
    name: 'Cincinnati',
    addressLine: null,
    city: 'Cincinnati',
    state: 'OH',
    zip: '45202',
    lat: 39.103100,
    lng: -84.512000,
    standardMinutes: 60,
    surchargeMinutes: 90,
  },
  {
    name: 'Elizabethtown',
    addressLine: null,
    city: 'Elizabethtown',
    state: 'KY',
    zip: '42701',
    lat: 37.694000,
    lng: -85.859100,
    standardMinutes: 30,
    surchargeMinutes: 60,
  },
  {
    name: 'Louisville',
    addressLine: null,
    city: 'Louisville',
    state: 'KY',
    zip: '40202',
    lat: 38.252700,
    lng: -85.758500,
    standardMinutes: 45,
    surchargeMinutes: 90,
  },
  {
    name: 'Bardstown',
    addressLine: null,
    city: 'Bardstown',
    state: 'KY',
    zip: '40004',
    lat: 37.808900,
    lng: -85.466900,
    standardMinutes: 30,
    surchargeMinutes: 60,
  },
]

const DEFAULT_SURCHARGE_CENTS = 5000
const DEFAULT_PHONE = '859-395-8188'

async function main() {
  const results: Array<{
    name: string
    status: 'created' | 'updated' | 'unchanged'
    id: string
  }> = []

  for (const c of CENTERS) {
    const existing = await prisma.serviceCenter.findUnique({
      where: { name: c.name },
      select: {
        id: true,
        addressLine: true,
        city: true,
        state: true,
        zip: true,
        lat: true,
        lng: true,
        standardMinutes: true,
        surchargeMinutes: true,
        surchargeCents: true,
        contactPhone: true,
        isActive: true,
      },
    })

    if (!existing) {
      const created = await prisma.serviceCenter.create({
        data: {
          name: c.name,
          addressLine: c.addressLine,
          city: c.city,
          state: c.state,
          zip: c.zip,
          lat: c.lat,
          lng: c.lng,
          standardMinutes: c.standardMinutes,
          surchargeMinutes: c.surchargeMinutes,
          surchargeCents: DEFAULT_SURCHARGE_CENTS,
          contactPhone: DEFAULT_PHONE,
          isActive: true,
        },
        select: { id: true },
      })
      results.push({ name: c.name, status: 'created', id: created.id })
    } else {
      // WHY: skip when row already matches; never clobber admin edits.
      results.push({ name: c.name, status: 'unchanged', id: existing.id })
    }
  }

  const created = results.filter((r) => r.status === 'created').length
  const unchanged = results.filter((r) => r.status === 'unchanged').length
  console.log(`\nSeed complete: ${created} created, ${unchanged} unchanged.`)
  console.log('Per-center status:')
  for (const r of results) {
    console.log(`  ${r.status.padEnd(9)} ${r.name.padEnd(16)} ${r.id}`)
  }

  // WHY: leave a single audit row marking the seed run for traceability.
  if (created > 0) {
    await prisma.auditLog.create({
      data: {
        action: 'service_center.create',
        targetType: 'ServiceCenter',
        targetId: null,
        actorRole: 'system',
        metadata: {
          source: 'script:_seed-service-centers',
          createdNames: results
            .filter((r) => r.status === 'created')
            .map((r) => r.name),
          totalCenters: results.length,
        },
      },
    })
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
