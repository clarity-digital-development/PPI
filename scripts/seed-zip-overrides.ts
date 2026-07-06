/**
 * Seed the service-area ZIP overrides (CR1 / Round 22).
 *
 * The straight-line haversine drive-time model under-predicts for some rural
 * KY corridors, so genuinely far ZIPs never trip the $50 surcharge band (e.g.
 * Danville 40422 estimates ~34 min but is a ~53 min real drive). These ZIPs are
 * marked out-of-area authoritatively via the ServiceAreaZipOverride table, which
 * resolveServiceArea() consults before the distance model.
 *
 * Idempotent (upsert on the `zip` PK). DRY-RUN by default — pass --apply to write.
 *
 *   npx tsx scripts/seed-zip-overrides.ts            # preview only
 *   npx tsx scripts/seed-zip-overrides.ts --apply    # write to DATABASE_URL
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

const APPLY = process.argv.includes('--apply')

interface ZipOverrideSeed {
  zip: string
  tier: 'surcharge' | 'out_of_area' | 'standard'
  surchargeCents: number
  note: string
}

// D6 (Round 22): Danville + neighboring far ZIPs observed escaping the fee.
// 40475 Richmond removed 2026-07-06 after Ryan reported Andi Kelley (34-min
// drive, 28mi) charged $50 by the blanket zip rule — 40475 covers close-to-Lex
// addresses too, so the override was over-broad. Now falls through to the
// distance model like every non-listed ZIP. Broader OOA overhaul (retire the
// override table entirely, address→drive-time on every checkout) queued for
// Tanner's direction — see the audit report.
const OVERRIDES: ZipOverrideSeed[] = [
  { zip: '40422', tier: 'surcharge', surchargeCents: 5000, note: 'Danville KY — ~53min real drive (model est ~34min). CR1.' },
  { zip: '40468', tier: 'surcharge', surchargeCents: 5000, note: 'Perryville KY — far from Lexington center.' },
  { zip: '40444', tier: 'surcharge', surchargeCents: 5000, note: 'Lancaster KY — far from Lexington center.' },
]

async function main() {
  console.log(`ZIP-override seed — ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes; pass --apply to write)'}`)
  for (const o of OVERRIDES) {
    console.log(`  ${o.zip}  tier=${o.tier}  $${(o.surchargeCents / 100).toFixed(2)}  — ${o.note}`)
  }
  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to upsert these rows.')
    return
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) })
  try {
    for (const o of OVERRIDES) {
      await prisma.serviceAreaZipOverride.upsert({
        where: { zip: o.zip },
        update: { tier: o.tier, surchargeCents: o.surchargeCents, note: o.note, isActive: true },
        create: { zip: o.zip, tier: o.tier, surchargeCents: o.surchargeCents, note: o.note, isActive: true },
      })
      console.log(`  upserted ${o.zip}`)
    }
    console.log(`\nDone — ${OVERRIDES.length} ZIP overrides upserted.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
