/**
 * Recovery (Oct 2026): load the reconstructed business data into the new
 * database from the merged files in ppi-recovery\rebuild\final\ (users, teams,
 * team members, cards, invoices, orders + installations, service requests,
 * post-rental charges, promo usages, customer inventory).
 *
 * Records refer to each other by natural keys (email, order number, invoice
 * number, team + member name, catalog names); this resolves them to ids, keeps
 * original ids where they were recovered, and skips rows marked
 * importAction "hold". Everything runs in ONE transaction: a dry run does the
 * full import and then rolls it back, so it proves every row and link fits the
 * schema without leaving anything behind. Expects an empty business database
 * (reference tables loaded by seed-reference.ts). Never sends email, never
 * calls Stripe.
 *
 *   DATABASE_URL=<session pooler> npx tsx scripts/recovery/import-rebuild.ts <finalDir>           # dry run
 *   DATABASE_URL=<session pooler> npx tsx scripts/recovery/import-rebuild.ts <finalDir> --apply
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { poolConfig } from '../../lib/db/pool-config'

type Row = Record<string, any>
const [dir, flag] = process.argv.slice(2)
const apply = flag === '--apply'
if (!dir) throw new Error('usage: import-rebuild.ts <finalDir> [--apply]')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set explicitly')

const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool(poolConfig(process.env.DATABASE_URL))) })

class Rollback extends Error {}

// Recovered values can carry notes ("2026-06-05 (approx)"); keep the leading date/time.
function date(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (typeof v !== 'string' || !v) return null
  const m = v.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/)
  if (!m) return null
  const d = new Date(m[1] ? m[0] : `${m[0]}T12:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}
const dec = (v: unknown) => (v === null || v === undefined || v === '' ? null : new Prisma.Decimal(String(v)))
const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
const bool = (v: unknown, dflt = false) => (v === null || v === undefined ? dflt : Boolean(v))
const id = (v: unknown) => (typeof v === 'string' && v ? v : randomUUID())
const email = (v: unknown) => (typeof v === 'string' && v ? v.toLowerCase().trim() : null)
const held = (r: Row) => r.importAction === 'hold'

const problems: string[] = []
function need<T>(map: Map<string, T>, key: string | null | undefined, what: string, ctx: string): T | null {
  if (!key) return null
  const v = map.get(key)
  if (v === undefined) problems.push(`${ctx}: unknown ${what} "${key}"`)
  return v ?? null
}

async function main() {
  const host = new URL(process.env.DATABASE_URL!).hostname
  console.log(`${apply ? 'APPLY' : 'DRY RUN (rolled back at the end)'} against ${host}`)

  const usersF = load('users.json')
  const teamsF = load('teams.json')
  const membersF = load('team-members.json')
  const cardsF = load('payment-methods.json')
  const promoF = load('promo-usages.json')
  const invoicesF = load('invoices.json')
  const ordersF = load('orders.json')
  const srF = load('service-requests.json')
  const rentalF = load('post-rental-charges.json')
  const invF = load('inventory.json')

  const existing = await prisma.user.count()
  if (existing > 0) throw new Error(`users table already has ${existing} rows; this importer expects an empty business database`)

  const counts: Record<string, number> = {}
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n)

  await prisma.$transaction(
    async (tx) => {
      // Reference tables (loaded by seed-reference.ts)
      const postTypes = new Map((await tx.postType.findMany()).map((p) => [p.name, p.id]))
      const riders = new Map((await tx.riderCatalog.findMany()).map((r) => [r.name, r.id]))
      const lockboxTypes = new Map((await tx.lockboxType.findMany()).map((l) => [l.name, l.id]))
      const centers = new Map((await tx.serviceCenter.findMany()).map((c) => [c.name, c.id]))
      const promos = new Map((await tx.promoCode.findMany()).map((p) => [p.code, p.id]))

      // Teams
      const teamIds = new Map<string, string>()
      for (const t of teamsF.records as Row[]) {
        const tid = id(t.id)
        await tx.team.create({
          data: { id: tid, name: t.name, freeLockboxInstall: bool(t.freeLockboxInstall), pickupFeeWaived: bool(t.pickupFeeWaived), createdAt: date(t.createdAt) ?? undefined },
        })
        teamIds.set(t.name, tid)
        bump('teams')
      }

      // Users (no passwords: everyone chooses one at sign-in)
      const userIds = new Map<string, string>()
      for (const u of usersF.records as Row[]) {
        const uid = id(u.id)
        const e = email(u.email)!
        await tx.user.create({
          data: {
            id: uid,
            email: e,
            emailVerified: date(u.emailVerified),
            password: null,
            name: str(u.name),
            image: str(u.image),
            fullName: str(u.fullName),
            phone: str(u.phone),
            company: str(u.company),
            role: u.role,
            stripeCustomerId: str(u.stripeCustomerId),
            isServiceAreaExempt: bool(u.isServiceAreaExempt),
            invoiceBilling: bool(u.invoiceBilling),
            flatFeeBilling: bool(u.flatFeeBilling),
            freeLockboxInstall: bool(u.freeLockboxInstall),
            invoiceDiscountPercent: dec(u.invoiceDiscountPercent),
            postRentalChargedFrom: date(u.postRentalChargedFrom),
            billingEmail: str(u.billingEmail),
            teamId: need(teamIds, u.teamName, 'team', `user ${e}`),
            emailOrderConfirmations: bool(u.emailOrderConfirmations, true),
            emailServiceRequests: bool(u.emailServiceRequests, true),
            emailMarketing: bool(u.emailMarketing),
            notificationPrefsUpdatedAt: date(u.notificationPrefsUpdatedAt),
            policyNoticeAcceptedAt: date(u.policyNoticeAcceptedAt),
            policyNoticeVersion: typeof u.policyNoticeVersion === 'number' ? u.policyNoticeVersion : 0,
            createdAt: date(u.createdAt) ?? undefined,
          },
        })
        userIds.set(e, uid)
        bump('users')
      }

      // Team members
      const memberIds = new Map<string, string>()
      for (const m of membersF.records as Row[]) {
        const teamId = need(teamIds, m.teamName, 'team', `member ${m.name}`)
        if (!teamId) continue
        const mid = id(m.id)
        await tx.teamMember.create({
          data: {
            id: mid,
            teamId,
            name: m.name,
            email: str(m.email),
            phone: str(m.phone),
            userId: m.userEmail ? need(userIds, email(m.userEmail), 'user', `member ${m.name}`) : null,
            removedAt: date(m.removedAt),
            createdAt: date(m.createdAt) ?? undefined,
          },
        })
        memberIds.set(`${m.teamName}|${m.name}`, mid)
        bump('teamMembers')
      }
      const member = (a: Row | null | undefined, ctx: string) =>
        a?.teamName && a?.memberName ? need(memberIds, `${a.teamName}|${a.memberName}`, 'team member', ctx) : null

      // Saved cards
      for (const c of cardsF.records as Row[]) {
        const userId = need(userIds, email(c.userEmail), 'user', `card ${c.stripePaymentMethodId}`)
        if (!userId) continue
        await tx.paymentMethod.create({
          data: {
            id: id(c.id),
            userId,
            stripePaymentMethodId: c.stripePaymentMethodId,
            brand: String(c.brand),
            last4: String(c.last4),
            expMonth: Number(c.expMonth),
            expYear: Number(c.expYear),
            isDefault: bool(c.isDefault),
            createdAt: date(c.createdAt) ?? undefined,
          },
        })
        bump('paymentMethods')
      }

      // Invoices
      const invoiceIds = new Map<string, string>()
      for (const i of invoicesF.invoices as Row[]) {
        if (held(i)) continue
        const userId = need(userIds, email(i.userEmail), 'user', `invoice ${i.invoiceNumber}`)
        if (!userId) continue
        const iid = id(i.id)
        await tx.invoice.create({
          data: {
            id: iid,
            invoiceNumber: i.invoiceNumber,
            userId,
            rangeStart: date(i.rangeStart)!,
            rangeEnd: date(i.rangeEnd)!,
            subtotal: dec(i.subtotal)!,
            total: dec(i.total)!,
            discountPercent: dec(i.discountPercent),
            discountAmount: dec(i.discountAmount),
            status: i.status,
            sentAt: date(i.sentAt),
            paidAt: date(i.paidAt),
            voidedAt: date(i.voidedAt),
            paymentIntentId: str(i.paymentIntentId),
            checkoutSessionId: str(i.checkoutSessionId),
            checkoutUrl: str(i.checkoutUrl),
            publicPdfToken: str(i.publicPdfToken),
            invoiceEmailSentAt: date(i.invoiceEmailSentAt),
            // Imported invoices were already handled; never let a worker pick them up.
            emailStatus: i.emailStatus === 'queued' || i.emailStatus === 'sending' ? 'sent' : i.emailStatus,
            recipientEmail: str(i.recipientEmail),
            emailError: str(i.emailError),
            adjustments: i.adjustments ?? undefined,
            createdAt: date(i.createdAt) ?? undefined,
          },
        })
        invoiceIds.set(i.invoiceNumber, iid)
        bump('invoices')
      }
      const pickupInvoiceOf = new Map<string, string>()
      for (const i of invoicesF.invoices as Row[]) {
        for (const n of i.covers?.ooaPickupOrderNumbers ?? []) {
          const iid = invoiceIds.get(i.invoiceNumber)
          if (iid) pickupInvoiceOf.set(n, iid)
        }
      }

      // Orders, items, installations
      const orderIds = new Map<string, string>()
      const orderUser = new Map<string, string>()
      const installationIds = new Map<string, string>()
      // On-site lockbox -> the customer's inventory box: by the merge key the
      // rebuild recorded, else by a unique (type, code, order owner) match.
      const pendingLockboxLinks: { installationLockboxId: string; key: string | null; fallback: string | null }[] = []
      const normCode = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
      for (const o of ordersF.orders as Row[]) {
        if (held(o)) {
          bump('ordersHeld')
          continue
        }
        const ctx = `order ${o.orderNumber}`
        const userId = need(userIds, email(o.userEmail), 'user', ctx)
        if (!userId) continue
        // Required columns with no default: report and skip rather than abort,
        // so one dry run lists every gap.
        const missing = ['propertyAddress', 'propertyCity', 'propertyZip', 'subtotal', 'total', 'status', 'paymentStatus'].filter(
          (f) => o[f] === null || o[f] === undefined || o[f] === '',
        )
        if (missing.length) {
          problems.push(`${ctx}: missing required ${missing.join(', ')}`)
          bump('ordersSkippedMissingRequired')
          continue
        }
        const oid = id(o.id)
        await tx.order.create({
          data: {
            id: oid,
            orderNumber: o.orderNumber,
            userId,
            postTypeId: need(postTypes, o.postTypeName, 'post type', ctx),
            propertyAddress: o.propertyAddress,
            propertyCity: o.propertyCity,
            propertyState: o.propertyState ?? 'KY',
            propertyZip: o.propertyZip,
            propertyType: o.propertyType ?? undefined,
            propertyNotes: str(o.propertyNotes),
            installationLocationImage: str(o.installationLocationImage),
            isGatedCommunity: bool(o.isGatedCommunity),
            gateCode: str(o.gateCode),
            hasMarkerPlaced: bool(o.hasMarkerPlaced),
            signOrientation: str(o.signOrientation),
            signOrientationOther: str(o.signOrientationOther),
            installationLocation: str(o.installationLocation),
            streetNumbersVisible: o.streetNumbersVisible ?? null,
            scheduledDate: date(o.scheduledDate),
            isExpedited: bool(o.isExpedited),
            subtotal: dec(o.subtotal)!,
            fuelSurcharge: dec(o.fuelSurcharge) ?? undefined,
            noPostSurcharge: dec(o.noPostSurcharge) ?? undefined,
            serviceAreaSurchargeCents: Number(o.serviceAreaSurchargeCents ?? 0),
            serviceAreaCenterId: need(centers, o.serviceAreaCenterName, 'service center', ctx),
            serviceAreaDriveMinutes: o.serviceAreaDriveMinutes ?? null,
            serviceAreaDriveMiles: dec(o.serviceAreaDriveMiles),
            serviceAreaDriveTimeSource: str(o.serviceAreaDriveTimeSource),
            serviceAreaSecondChargeCents: o.serviceAreaSecondChargeCents ?? null,
            serviceAreaSecondChargeStatus: o.serviceAreaSecondChargeStatus ?? null,
            serviceAreaSecondChargePaymentIntentId: str(o.serviceAreaSecondChargePaymentIntentId),
            serviceAreaSecondChargedAt: date(o.serviceAreaSecondChargedAt),
            serviceAreaSecondChargeInvoiceId: pickupInvoiceOf.get(o.orderNumber) ?? null,
            flatFeeApplied: bool(o.flatFeeApplied),
            flatFeeBase: dec(o.flatFeeBase),
            expediteFee: dec(o.expediteFee) ?? undefined,
            discount: dec(o.discount) ?? undefined,
            tax: dec(o.tax) ?? undefined,
            total: dec(o.total)!,
            promoCodeId: need(promos, o.promoCode, 'promo code', ctx),
            status: o.status,
            paymentStatus: o.paymentStatus,
            paymentIntentId: str(o.paymentIntentId),
            paidAt: date(o.paidAt),
            placedByUserId: o.placedByUserEmail ? need(userIds, email(o.placedByUserEmail), 'user', ctx) : null,
            placedForAgentName: str(o.placedForAgentName),
            refundId: str(o.refundId),
            refundInitiatedAt: date(o.refundInitiatedAt),
            refundedAt: date(o.refundedAt),
            refundedAmount: dec(o.refundedAmount),
            refundReason: str(o.refundReason),
            refundEmailSentAt: date(o.refundEmailSentAt),
            confirmationEmailSentAt: date(o.confirmationEmailSentAt),
            cancelledAt: date(o.cancelledAt),
            cancelledByUserId: o.cancelledByUserEmail ? need(userIds, email(o.cancelledByUserEmail), 'user', ctx) : null,
            cancelReason: str(o.cancelReason),
            postRentalDisabled: bool(o.postRentalDisabled),
            postRentalStoppedAt: date(o.postRentalStoppedAt),
            invoiceId: o.invoiceNumber ? need(invoiceIds, o.invoiceNumber, 'invoice', ctx) : null,
            editChargeStatus: o.editChargeStatus ?? null,
            lastEditPaymentIntentId: str(o.lastEditPaymentIntentId),
            lastEditChargedAt: date(o.lastEditChargedAt),
            pendingCreditCents: Number(o.pendingCreditCents ?? 0),
            area: str(o.area),
            postInvoiceAdjustmentCents: Number(o.postInvoiceAdjustmentCents ?? 0),
            sweptAdjustmentCents: Number(o.sweptAdjustmentCents ?? 0),
            postInvoiceBaselineCents: o.postInvoiceBaselineCents ?? null,
            createdAt: date(o.createdAt) ?? undefined,
          },
        })
        orderIds.set(o.orderNumber, oid)
        orderUser.set(o.orderNumber, userId)
        bump('orders')

        const items = (o.items as Row[] | undefined) ?? []
        if (items.length) {
          await tx.orderItem.createMany({
            data: items.map((it) => ({
              id: randomUUID(),
              orderId: oid,
              itemType: String(it.itemType),
              itemCategory: str(it.itemCategory),
              description: String(it.description),
              quantity: Number(it.quantity ?? 1),
              unitPrice: dec(it.unitPrice) ?? new Prisma.Decimal(0),
              totalPrice: dec(it.totalPrice) ?? new Prisma.Decimal(0),
              riderId: it.riderName ? riders.get(it.riderName) ?? null : null,
              customValue: str(it.customValue),
              createdAt: date(o.createdAt) ?? undefined,
            })),
          })
          bump('orderItems', items.length)
        }

        const inst = o.installation as Row | null
        if (inst) {
          const iid = id(inst.id)
          const installedAt = date(inst.installedAt) ?? date(inst.installedAtEstimate?.value ?? inst.installedAtEstimate)
          if (!installedAt) problems.push(`${ctx}: installation has no installedAt`)
          await tx.installation.create({
            data: {
              id: iid,
              orderId: oid,
              userId,
              propertyAddress: inst.propertyAddress ?? o.propertyAddress,
              propertyCity: inst.propertyCity ?? o.propertyCity,
              propertyState: inst.propertyState ?? o.propertyState ?? 'KY',
              propertyZip: inst.propertyZip ?? o.propertyZip,
              installedAt: installedAt ?? undefined,
              status: inst.status,
              removalDate: date(inst.removalDate),
              removedAt: date(inst.removedAt) ?? date(inst.removedAtEstimate?.value ?? inst.removedAtEstimate),
            },
          })
          installationIds.set(o.orderNumber, iid)
          bump('installations')
          for (const r of (inst.riders as Row[] | undefined) ?? []) {
            const riderId = r.riderName ? riders.get(r.riderName) : undefined
            if (!riderId) {
              bump('installationRidersSkippedNotInCatalog')
              continue
            }
            await tx.installationRider.create({
              data: { installationId: iid, riderId, isRental: bool(r.isRental), installedAt: date(r.installedAt) ?? installedAt ?? undefined, removedAt: date(r.removedAt) },
            })
            bump('installationRiders')
          }
          for (const l of (inst.lockboxes as Row[] | undefined) ?? []) {
            const typeId = need(lockboxTypes, l.lockboxTypeName, 'lockbox type', `${ctx} lockbox`)
            if (!typeId) continue
            const lid = randomUUID()
            await tx.installationLockbox.create({
              data: { id: lid, installationId: iid, lockboxTypeId: typeId, isRental: bool(l.isRental), code: str(l.code), installedAt: date(l.installedAt) ?? installedAt ?? undefined, removedAt: date(l.removedAt) },
            })
            const fallback = l.code ? `${l.lockboxTypeName}|${normCode(l.code)}|${email(o.userEmail)}` : null
            if (l.customerLockbox?.inventoryMergeKey || fallback) {
              pendingLockboxLinks.push({ installationLockboxId: lid, key: l.customerLockbox?.inventoryMergeKey ?? null, fallback })
            }
            bump('installationLockboxes')
          }
        }
      }

      // Service requests
      for (const s of srF.serviceRequests as Row[]) {
        if (held(s)) continue
        const ctx = `service request ${s.key}`
        const userId = need(userIds, email(s.userEmail), 'user', ctx)
        if (!userId) continue
        await tx.serviceRequest.create({
          data: {
            id: id(s.id),
            installationId: s.installationOrderNumber ? need(installationIds, s.installationOrderNumber, 'installation', ctx) : null,
            userId,
            type: s.type,
            status: s.status,
            description: str(s.description),
            requestedDate: date(s.requestedDate),
            notes: str(s.notes),
            adminNotes: str(s.adminNotes),
            completedAt: date(s.completedAt),
            invoiceAmount: dec(s.invoiceAmount),
            invoiceStatus: str(s.invoiceStatus),
            invoicePaymentIntentId: str(s.invoicePaymentIntentId),
            invoicePaidAt: date(s.invoicePaidAt),
            invoiceId: s.invoiceNumber ? need(invoiceIds, s.invoiceNumber, 'invoice', ctx) : null,
            unlistedAddress: str(s.unlistedAddress),
            unlistedCity: str(s.unlistedCity),
            unlistedState: str(s.unlistedState),
            unlistedZip: str(s.unlistedZip),
            createdAt: date(s.createdAt) ?? undefined,
          },
        })
        bump('serviceRequests')
      }

      // Post-rental charges
      for (const c of rentalF.postRentalCharges as Row[]) {
        if (held(c)) continue
        const orderId = need(orderIds, c.orderNumber, 'order', `rental ${c.key}`)
        if (!orderId) continue
        await tx.postRentalCharge.create({
          data: {
            id: id(c.id),
            orderId,
            chargeType: c.chargeType,
            amountCents: Number(c.amountCents),
            periodStart: date(c.periodStart)!,
            periodEnd: date(c.periodEnd)!,
            stripePaymentIntentId: str(c.stripePaymentIntentId),
            status: c.status,
            attemptedAt: date(c.attemptedAt),
            succeededAt: date(c.succeededAt),
            failureCode: str(c.failureCode),
            failureMessage: str(c.failureMessage),
            attemptCount: Number(c.attemptCount ?? 0),
            invoiceId: c.invoiceNumber ? need(invoiceIds, c.invoiceNumber, 'invoice', `rental ${c.key}`) : null,
            createdAt: date(c.createdAt) ?? undefined,
          },
        })
        bump('postRentalCharges')
      }

      // Promo usages
      for (const p of promoF.records as Row[]) {
        const userId = need(userIds, email(p.userEmail), 'user', `promo usage ${p.code}`)
        const promoCodeId = need(promos, p.code, 'promo code', `promo usage ${p.userEmail}`)
        if (!userId || !promoCodeId) continue
        await tx.promoCodeUsage.create({ data: { id: id(p.id), userId, promoCodeId, usedAt: date(p.usedAt) ?? undefined } })
        bump('promoUsages')
      }

      // Customer inventory
      const lockboxByKey = new Map<string, string>()
      const lockboxByCode = new Map<string, string[]>()
      const models = invF.models as Record<string, { records: Row[] }>
      for (const l of models.CustomerLockbox.records) {
        if (held(l)) continue
        const ctx = `lockbox ${l.lockboxTypeName}`
        const userId = need(userIds, email(l.userEmail), 'user', ctx)
        const typeId = need(lockboxTypes, l.lockboxTypeName, 'lockbox type', ctx)
        if (!userId || !typeId) continue
        const lid = id(l.id)
        await tx.customerLockbox.create({
          data: { id: lid, userId, lockboxTypeId: typeId, serialNumber: str(l.serialNumber), code: str(l.code), isOwned: bool(l.isOwned, true), inStorage: bool(l.inStorage, true), assignedToMemberId: member(l.assignedToMember, ctx), createdAt: date(l.createdAt) ?? undefined },
        })
        lockboxByKey.set(`lockbox|${l.lockboxTypeName}|${l.code ?? l.serialNumber ?? ''}|${email(l.userEmail)}`, lid)
        const codeKey = `${l.lockboxTypeName}|${normCode(l.code ?? l.serialNumber)}|${email(l.userEmail)}`
        lockboxByCode.set(codeKey, [...(lockboxByCode.get(codeKey) ?? []), lid])
        bump('customerLockboxes')
      }
      for (const s of models.CustomerSign.records) {
        if (held(s)) continue
        const userId = need(userIds, email(s.userEmail), 'user', 'sign')
        if (!userId) continue
        await tx.customerSign.create({
          data: { id: id(s.id), userId, description: String(s.description), imageUrl: str(s.imageUrl), inStorage: bool(s.inStorage, true), assignedToMemberId: member(s.assignedToMember, 'sign'), createdAt: date(s.createdAt) ?? undefined },
        })
        bump('customerSigns')
      }
      for (const r of models.CustomerRider.records) {
        if (held(r)) continue
        const userId = need(userIds, email(r.userEmail), 'user', 'rider')
        const riderId = need(riders, r.riderName, 'rider', 'customer rider')
        if (!userId || !riderId) continue
        await tx.customerRider.create({
          data: { id: id(r.id), userId, riderId, isOwned: bool(r.isOwned, true), inStorage: bool(r.inStorage, true), assignedToMemberId: member(r.assignedToMember, 'rider'), createdAt: date(r.createdAt) ?? undefined },
        })
        bump('customerRiders')
      }
      for (const b of models.CustomerBrochureBox.records) {
        if (held(b)) continue
        const userId = need(userIds, email(b.userEmail), 'user', 'brochure box')
        if (!userId) continue
        await tx.customerBrochureBox.create({
          data: { id: id(b.id), userId, description: str(b.description), inStorage: bool(b.inStorage, true), assignedToMemberId: member(b.assignedToMember, 'brochure box'), createdAt: date(b.createdAt) ?? undefined },
        })
        bump('customerBrochureBoxes')
      }
      for (const x of models.CustomerOtherItem.records) {
        if (held(x)) continue
        const userId = need(userIds, email(x.userEmail), 'user', 'other item')
        if (!userId) continue
        await tx.customerOtherItem.create({
          data: { id: id(x.id), userId, description: String(x.description), assignedToMemberId: member(x.assignedToMember, 'other item'), createdAt: date(x.createdAt) ?? undefined },
        })
        bump('customerOtherItems')
      }

      // Lockboxes on site -> the customer's inventory box
      for (const link of pendingLockboxLinks) {
        const byCode = link.fallback ? lockboxByCode.get(link.fallback) : undefined
        const lid = (link.key ? lockboxByKey.get(link.key) : undefined) ?? (byCode?.length === 1 ? byCode[0] : undefined)
        if (!lid) {
          bump('installationLockboxesWithoutInventoryMatch')
          continue
        }
        await tx.installationLockbox.update({ where: { id: link.installationLockboxId }, data: { customerLockboxId: lid } })
        bump('installationLockboxesLinked')
      }

      console.log('rows:', counts)
      if (problems.length) {
        console.log(`\n${problems.length} unresolved references:`)
        for (const p of problems.slice(0, 60)) console.log('  -', p)
        if (problems.length > 60) console.log(`  … ${problems.length - 60} more`)
      }
      if (!apply) throw new Rollback('dry run')
      if (problems.length) throw new Error(`refusing to commit with ${problems.length} unresolved references`)
    },
    { maxWait: 60_000, timeout: 15 * 60_000 },
  )
}

main()
  .then(() => console.log('Committed.'))
  .catch((e) => {
    if (e instanceof Rollback) {
      console.log('\nDry run complete: everything above was rolled back.')
      return
    }
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
