import { readFileSync } from 'fs'
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { audit, AuditAction } = await import('../lib/audit')

  // Ryan's revised bands (2026-06-05):
  //   Cincinnati standard: 60 → 45 (surcharge cutoff 90 unchanged)
  //   Elizabethtown standard: 30 → 25 (cutoff 60 unchanged)
  //   Bardstown standard: 30 → 25 (cutoff 60 unchanged)
  const updates = [
    { name: 'Cincinnati', newStandard: 45 },
    { name: 'Elizabethtown', newStandard: 25 },
    { name: 'Bardstown', newStandard: 25 },
  ]

  for (const u of updates) {
    const current = await prisma.serviceCenter.findFirst({ where: { name: u.name } })
    if (!current) {
      console.log(`SKIP ${u.name}: row not found`)
      continue
    }
    if (current.standardMinutes === u.newStandard) {
      console.log(`SKIP ${u.name}: standardMinutes already = ${u.newStandard}`)
      continue
    }

    const before = { standardMinutes: current.standardMinutes }
    const after = { standardMinutes: u.newStandard }

    await prisma.serviceCenter.update({
      where: { id: current.id },
      data: { standardMinutes: u.newStandard },
    })

    await audit({
      actor: { system: true },
      action: AuditAction.ServiceCenterUpdate,
      targetType: 'service_center',
      targetId: current.id,
      metadata: {
        center: u.name,
        diff: { standardMinutes: { from: before.standardMinutes, to: after.standardMinutes } },
        reason: "Ryan's 2026-06-05 revision: Cincy down to 45, E-town and Bardstown down to 25",
        source: 'script:_adjust-service-centers',
      },
    })

    console.log(`UPDATED ${u.name}: standardMinutes ${before.standardMinutes} → ${after.standardMinutes}`)
  }

  console.log('\n=== Final ServiceCenter state ===')
  const all = await prisma.serviceCenter.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      name: true,
      standardMinutes: true,
      surchargeMinutes: true,
      surchargeCents: true,
      contactPhone: true,
    },
  })
  for (const c of all) {
    console.log(
      `  ${c.name.padEnd(15)} std<=${c.standardMinutes}m  surcharge ${c.standardMinutes}-${c.surchargeMinutes}m  cutoff >${c.surchargeMinutes}m  fee=$${c.surchargeCents / 100}  ${c.contactPhone}`,
    )
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
