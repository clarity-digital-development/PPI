/**
 * Seeds a ready-to-test team_admin account for client testing:
 *   test@pinkposts.com / PinkPosts2026
 *
 * Creates a team with members, assigned inventory, agent-attributed orders
 * (some editable, one completed), and a service request — enough to exercise
 * every new feature. Idempotent: re-running wipes and recreates the account.
 *
 *   npx tsx scripts/seed-test-account.ts
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const orderNo = () => 'PPI-TEST-' + Math.random().toString(36).slice(2, 7).toUpperCase()

async function main() {
  const email = 'test@pinkposts.com'

  // Idempotent reset: remove a prior test account + its team.
  const prior = await prisma.user.findUnique({ where: { email } })
  if (prior) {
    await prisma.order.deleteMany({ where: { userId: prior.id } })
    await prisma.serviceRequest.deleteMany({ where: { userId: prior.id } })
    const teamId = prior.teamId
    await prisma.user.delete({ where: { id: prior.id } })
    if (teamId) await prisma.team.delete({ where: { id: teamId } })
  }

  const password = await bcrypt.hash('PinkPosts2026', 10)
  // freeLockboxInstall on so the client can see the Semonin-style perk ($0
  // owned-lockbox install; rental still charged).
  const team = await prisma.team.create({ data: { name: "Ryan's Test Team", freeLockboxInstall: true } })
  const user = await prisma.user.create({
    data: {
      email, password, role: 'team_admin',
      // team_admin accounts default to invoice billing — matches the
      // promotion cascade in /api/admin/customers/[id] PUT.
      invoiceBilling: true,
      fullName: 'Ryan Test (Team Admin)', name: 'Ryan Test',
      phone: '859-555-0100', company: 'Test Realty Group', teamId: team.id,
    },
  })

  const ashley = await prisma.teamMember.create({ data: { teamId: team.id, name: 'Ashley Carter', email: 'ashley@testrealty.com', phone: '859-555-0111' } })
  const marcus = await prisma.teamMember.create({ data: { teamId: team.id, name: 'Marcus Bell', email: 'marcus@testrealty.com' } })
  await prisma.teamMember.create({ data: { teamId: team.id, name: 'Diana Reyes' } })

  // Inventory owned by the team_admin, some assigned to agents, some not.
  await prisma.customerSign.createMany({ data: [
    { userId: user.id, description: '123 Oak St — For Sale', assignedToMemberId: ashley.id },
    { userId: user.id, description: '456 Maple Ave — For Sale', assignedToMemberId: ashley.id },
    { userId: user.id, description: '789 Pine Rd — Coming Soon', assignedToMemberId: marcus.id },
    { userId: user.id, description: 'Generic Open House Sign' },
  ] })
  const riderCat = await prisma.riderCatalog.findFirst()
  if (riderCat) {
    await prisma.customerRider.createMany({ data: [
      { userId: user.id, riderId: riderCat.id, assignedToMemberId: ashley.id },
      { userId: user.id, riderId: riderCat.id },
    ] })
  }
  const lockboxType = await prisma.lockboxType.findFirst()
  if (lockboxType) {
    await prisma.customerLockbox.create({ data: { userId: user.id, lockboxTypeId: lockboxType.id, code: 'TEST-1234', assignedToMemberId: marcus.id } })
  }
  await prisma.customerBrochureBox.create({ data: { userId: user.id, description: 'Brochure Box' } })

  // Agent-attributed orders — two editable, one completed.
  const pink = await prisma.postType.findFirst({ where: { name: 'Signature Pink Post' } })
  const metal = await prisma.postType.findFirst({ where: { name: 'Metal Frame Sign' } })
  const baseProp = { userId: user.id, propertyType: 'house' as const, propertyCity: 'Lexington', propertyState: 'KY', propertyZip: '40502', signOrientation: 'installer_decides', hasMarkerPlaced: true, fuelSurcharge: 2.47 }

  await prisma.order.create({ data: {
    ...baseProp, orderNumber: orderNo(), placedForAgentName: 'Ashley Carter', postTypeId: pink?.id ?? null,
    propertyAddress: '123 Oak St', status: 'pending', paymentStatus: 'succeeded',
    subtotal: 73, tax: 4.38, total: 79.85,
    orderItems: { create: [
      { itemType: 'post', itemCategory: 'new', description: 'Signature Pink Post (install & pickup)', quantity: 1, unitPrice: 65, totalPrice: 65 },
      { itemType: 'sign', itemCategory: 'owned', description: 'Sign Install', quantity: 1, unitPrice: 3, totalPrice: 3 },
      { itemType: 'rider', itemCategory: 'rental', description: 'Rider Rental: For Sale', quantity: 1, unitPrice: 5, totalPrice: 5 },
    ] },
  } })

  await prisma.order.create({ data: {
    ...baseProp, orderNumber: orderNo(), placedForAgentName: 'Marcus Bell', postTypeId: metal?.id ?? null,
    propertyAddress: '789 Pine Rd', status: 'confirmed', paymentStatus: 'succeeded',
    subtotal: 50, tax: 3.0, total: 55.47,
    orderItems: { create: [
      { itemType: 'post', itemCategory: 'new', description: 'Metal Frame Sign (install & pickup)', quantity: 1, unitPrice: 40, totalPrice: 40 },
      { itemType: 'lockbox', itemCategory: 'rental', description: 'Mechanical Lockbox Rental', quantity: 1, unitPrice: 10, totalPrice: 10 },
    ] },
  } })

  await prisma.order.create({ data: {
    ...baseProp, orderNumber: orderNo(), placedForAgentName: 'Ashley Carter', postTypeId: pink?.id ?? null,
    propertyAddress: '456 Maple Ave', status: 'completed', paymentStatus: 'succeeded',
    subtotal: 65, tax: 3.9, total: 71.37,
    orderItems: { create: [
      { itemType: 'post', itemCategory: 'new', description: 'Signature Pink Post (install & pickup)', quantity: 1, unitPrice: 65, totalPrice: 65 },
    ] },
  } })

  // A pending service request the customer can edit/cancel + admin can invoice.
  await prisma.serviceRequest.create({ data: {
    userId: user.id, type: 'service', status: 'pending',
    description: 'Please straighten the post at 123 Oak St — leaning after the storm.',
    notes: 'Flexible on timing this week.',
    unlistedAddress: '123 Oak St', unlistedCity: 'Lexington', unlistedState: 'KY', unlistedZip: '40502',
  } })

  console.log(JSON.stringify({ email, password: 'PinkPosts2026', role: 'team_admin', team: team.name, members: 3, orders: 3, serviceRequests: 1 }, null, 2))
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
