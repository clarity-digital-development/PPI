/**
 * Recovery (Oct 2026): load the reference tables into the new database from
 * the reconstructed seed input (service centers, post types, lockbox types,
 * rider catalog, promo codes). Upserts by each table's unique name/code and
 * keeps original ids where they were recovered, so rebuilt orders and
 * inventory can point at the same rows. Never deletes anything.
 *
 *   DATABASE_URL=<session pooler url> npx tsx scripts/recovery/seed-reference.ts <seed-input.json>          # dry run
 *   DATABASE_URL=<session pooler url> npx tsx scripts/recovery/seed-reference.ts <seed-input.json> --apply
 */
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { poolConfig } from '../../lib/db/pool-config'

type Row = Record<string, unknown>
const [inputPath, flag] = process.argv.slice(2)
const apply = flag === '--apply'
if (!inputPath) throw new Error('usage: seed-reference.ts <seed-input.json> [--apply]')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set explicitly')

const input = JSON.parse(readFileSync(inputPath, 'utf8')) as Record<string, Row[]>
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool(poolConfig(process.env.DATABASE_URL))) })

const dec = (v: unknown) => (v === null || v === undefined ? null : new Prisma.Decimal(String(v)))
// Recovered dates can carry a note ("2025-12-20T09:53:58.190Z (approx, from
// cuid)", "2026-09-20 between …"); use the leading date or time, else none.
const date = (v: unknown) => {
  const m = typeof v === 'string' ? v.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?/) : null
  if (!m) return undefined
  const d = new Date(m[1] ? m[0] : `${m[0]}T12:00:00Z`)
  return isNaN(d.getTime()) ? undefined : d
}
const id = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

async function main() {
  const host = new URL(process.env.DATABASE_URL!).hostname
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} against ${host}`)

  const plan = {
    serviceCenters: input.serviceCenters.map((c) => ({
      where: { name: String(c.name) },
      data: {
        addressLine: (c.addressLine as string | null) ?? null,
        city: String(c.city),
        state: String(c.state),
        zip: String(c.zip),
        lat: dec(c.lat)!,
        lng: dec(c.lng)!,
        standardMinutes: Number(c.standardMinutes),
        surchargeMinutes: Number(c.surchargeMinutes),
        surchargeCents: Number(c.surchargeCents),
        freeRadiusMiles: c.freeRadiusMiles === null || c.freeRadiusMiles === undefined ? null : Number(c.freeRadiusMiles),
        includedOverageMiles: Number(c.includedOverageMiles),
        perMileCents: Number(c.perMileCents),
        baseFeeCents: Number(c.baseFeeCents),
        contactPhone: String(c.contactPhone ?? '859-395-8188'),
        isActive: Boolean(c.isActive),
      },
      create: { id: id(c.id), createdAt: date(c.createdAt) },
    })),
    postTypes: input.postTypes.map((p) => ({
      where: { name: String(p.name) },
      data: {
        description: (p.description as string | null) ?? null,
        price: dec(p.price)!,
        imageUrl: (p.imageUrl as string | null) ?? null,
        isActive: Boolean(p.isActive),
      },
      create: { id: id(p.id), createdAt: date(p.createdAt) },
    })),
    lockboxTypes: input.lockboxTypes.map((l) => ({
      where: { name: String(l.name) },
      data: {
        description: (l.description as string | null) ?? null,
        rentalPrice: dec(l.rentalPrice),
        installFee: dec(l.installFee)!,
        isRentable: Boolean(l.isRentable),
        isActive: l.isActive === undefined ? true : Boolean(l.isActive),
      },
      create: { id: id(l.id), createdAt: date(l.createdAt) },
    })),
    riders: input.riders.map((r) => ({
      where: { name: String(r.name) },
      data: {
        description: (r.description as string | null) ?? null,
        rentalPrice: dec(r.rentalPrice ?? 5)!,
        isActive: r.isActive === undefined ? true : Boolean(r.isActive),
      },
      create: { id: id(r.id), createdAt: date(r.createdAt) },
    })),
    promoCodes: input.promoCodes.map((p) => ({
      where: { code: String(p.code) },
      data: {
        description: (p.description as string | null) ?? null,
        discountType: p.discountType as 'percentage' | 'fixed',
        discountValue: dec(p.discountValue)!,
        minOrderAmount: dec(p.minOrderAmount),
        maxUses: p.maxUses === null || p.maxUses === undefined ? null : Number(p.maxUses),
        startsAt: date(p.startsAt) ?? null,
        expiresAt: date(p.expiresAt) ?? null,
        waiveFuelSurcharge: Boolean(p.waiveFuelSurcharge),
        isActive: Boolean(p.isActive),
      },
      create: { id: id(p.id), createdAt: date(p.createdAt) },
    })),
  }

  for (const [table, rows] of Object.entries(plan)) console.log(`${table}: ${rows.length} rows`)
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write.')
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const r of plan.serviceCenters) await tx.serviceCenter.upsert({ where: r.where, update: r.data, create: { ...r.where, ...r.data, ...r.create } })
    for (const r of plan.postTypes) await tx.postType.upsert({ where: r.where, update: r.data, create: { ...r.where, ...r.data, ...r.create } })
    for (const r of plan.lockboxTypes) await tx.lockboxType.upsert({ where: r.where, update: r.data, create: { ...r.where, ...r.data, ...r.create } })
    for (const r of plan.riders) await tx.riderCatalog.upsert({ where: r.where, update: r.data, create: { ...r.where, ...r.data, ...r.create } })
    for (const r of plan.promoCodes) await tx.promoCode.upsert({ where: r.where, update: r.data, create: { ...r.where, ...r.data, ...r.create } })
  }, { timeout: 120_000 })

  const counts = {
    serviceCenters: await prisma.serviceCenter.count(),
    postTypes: await prisma.postType.count(),
    lockboxTypes: await prisma.lockboxType.count(),
    riders: await prisma.riderCatalog.count(),
    promoCodes: await prisma.promoCode.count(),
  }
  console.log('Now in database:', counts)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
