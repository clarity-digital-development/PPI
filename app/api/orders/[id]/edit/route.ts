import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { orderItemSchema } from '@/lib/validations'
import { validateScheduling } from '@/lib/scheduling'
import { sendAdminOrderNotification, sendOrderConfirmationEmail } from '@/lib/email'
import { resolveAssignedAgent } from '@/lib/orders/assigned-agent'
import { audit, AuditAction } from '@/lib/audit'
import { chargePaymentMethod, isDetachedPaymentMethodError } from '@/lib/stripe'
import { resolveEffectivePayer } from '@/lib/orders/effective-payer'
import { FLAT_FEE_BASE } from '@/lib/orders/pricing'
import { z } from 'zod'

// What happened to the customer's wallet as a result of this edit. The customer
// email + admin email show a one-liner derived from this so accountants can
// reconcile without opening Stripe. The `kind` mirrors the EditChargeStatus
// Prisma enum so it can be persisted directly to order.editChargeStatus.
type EditChargeOutcome =
  | { kind: 'no_change' } // diff === 0
  | { kind: 'invoice_billing_skip'; diff: number } // diff folds into next invoice
  | { kind: 'charged_diff'; diff: number; paymentIntentId: string; cardLast4: string | null; cardBrand: string | null; netDiff: number; appliedCreditCents: number }
  | { kind: 'charge_failed'; diff: number; reason: string }
  | { kind: 'no_payment_method'; diff: number } // diff > 0 but no card on file — admin must collect manually
  | { kind: 'credit_pending'; diff: number; pendingCreditCentsAfter: number } // diff < 0 — admin issues manual refund via Stripe dashboard

// Full edit payload. The order is rebuilt from this (mirrors order creation).
// The original payment intent, fuel surcharge, and applied promo code are
// preserved across the edit, but the DIFF between the old and new total IS
// charged at save time (positive diff → card on file, negative → flagged for
// manual refund, invoice-billing → folded into next invoice). See the
// chargeOutcome branch below. Property/scheduling fields are optional and
// fall back to the existing order when omitted so partial payloads can't wipe
// data.
const editOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
  // Post: a post type name, 'open_house', or 'none'/'' (no post).
  post_type: z.string().optional(),
  // Property
  property_type: z.string().optional(),
  property_address: z.string().optional(),
  property_city: z.string().optional(),
  property_state: z.string().optional(),
  property_zip: z.string().optional(),
  installation_location: z.string().optional(),
  installation_location_image: z.string().optional(),
  installation_notes: z.string().optional(),
  is_gated_community: z.boolean().optional(),
  gate_code: z.string().optional(),
  has_marker_placed: z.boolean().optional(),
  sign_orientation: z.string().optional(),
  sign_orientation_other: z.string().optional(),
  // Scheduling
  requested_date: z.string().optional(),
  is_expedited: z.boolean().optional(),
  // Optimistic concurrency token — client sends the order.total it observed
  // when loading the edit page. Server rejects (409) if the DB value diverges.
  // Optional for backwards compat: older clients without the token bypass the
  // check, accepting the last-write-wins behavior they have today.
  expected_total: z.number().optional(),
  // Customer inventory ids the form was AWARE of (rendered in its picker or
  // available to render — i.e. the customer had a chance to de-select them).
  // The server uses this to distinguish "customer intentionally removed this
  // rider" (in this set, not in items[]) from "form silently dropped a line
  // it couldn't represent" (NOT in this set, NOT in items[]). The latter get
  // preserved unchanged. Without this signal an admin-added rider like "Sarah
  // Arvin" (no catalog match) silently disappears on customer self-edit.
  client_aware_inventory: z.object({
    sign_ids: z.array(z.string()).default([]),
    rider_ids: z.array(z.string()).default([]),
    lockbox_ids: z.array(z.string()).default([]),
    brochure_box_ids: z.array(z.string()).default([]),
  }).optional(),
})

const NO_POST_SURCHARGE = 40
const EXPEDITE_FEE = 50
const FALLBACK_TAX_RATE = 0.06

const VALID_PROPERTY_TYPES = ['residential', 'commercial', 'land', 'multi_family', 'house', 'construction', 'bare_land']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Owner-OR-admin gate. Admins can edit any pending order on a customer's
    // behalf so they don't have to email the agent and ask for changes (per
    // Ryan's ask). The audit log at the end already records actor.role, so
    // admin edits are distinguishable from self-edits without further work.
    const existingOrder = await prisma.order.findFirst({
      where: user.role === 'admin' ? { id } : { id, userId: user.id },
      include: { orderItems: true, promoCode: true },
    })

    if (!existingOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Only allow editing non-completed, non-cancelled orders
    if (existingOrder.status === 'completed' || existingOrder.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot edit completed or cancelled orders' },
        { status: 400 }
      )
    }

    // Block edits on orders that have already been bundled onto an invoice
    // (invoiceId set). The invoice has a fixed total + a Stripe Payment Link
    // generated against the OLD price, so a silent edit would silently drift
    // both. Per Ryan: rare (most edits happen same-day), and the workflow is
    // to regenerate the invoice manually. This is a pre-flight check; the
    // invoice-bundle job could still attach invoiceId between here and the
    // transaction below, so the tx.order.updateMany also re-checks invoiceId.
    if (existingOrder.invoiceId) {
      return NextResponse.json(
        { error: 'Error: order already invoiced. Please contact 859-395-8188 to make changes.' },
        { status: 409 }
      )
    }

    const body = await request.json()
    const validationResult = editOrderSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const editData = validationResult.data

    // ---- Self-edit price-manipulation guard ----
    // The PATCH body's items[].total_price is currently trusted (same pattern
    // as order creation at app/api/orders/route.ts:217 — a pre-existing
    // codebase-wide trust we have not yet untangled). For admin edits that
    // trust is acceptable: admin is staff and authorized to set prices. For
    // customer self-edits it is still NOT fully validated server-side, so we
    // keep ONE defense-in-depth bound until server-side price recomputation
    // lands in a follow-up PR:
    //
    //   • Implausible inflation: a customer could push the total to something
    //     extreme — bounded at 2× original + $50. Still blocked.
    //
    // Negative-diff (cheaper-on-edit) used to be blocked too with the message
    // "self-edits cannot reduce the total" because it would manufacture a
    // refund obligation. That block was lifted on 2026-06-29 per Ryan: the
    // existing credit_pending pipeline already flags the order, surfaces the
    // dollar amount on /admin/orders + the order-detail page, AND emails the
    // customer with a "refund coming" notice — so admins can issue the manual
    // Stripe refund whenever, without the agent's edit being blocked. Ryan
    // explicitly accepted the small refund-fraud risk (real-estate agents
    // would lose their account; not worth blocking the legit edit-then-credit
    // flow that was breaking the date-change UX). Admin role still bypasses
    // the inflation bound — admin can refund or restructure freely.
    if (user.role !== 'admin') {
      const claimedSubtotal = editData.items.reduce((sum, item) => sum + item.total_price, 0)
      const originalTotal = Number(existingOrder.total)
      // Approximate new total before tax/fees just for the sanity bound. Real
      // total recomputation happens further down; this is a fast pre-check.
      const claimedTotalApprox = claimedSubtotal + Number(existingOrder.fuelSurcharge)
      if (claimedTotalApprox > originalTotal * 2 + 50) {
        return NextResponse.json(
          {
            error: 'This edit more than doubles the order total. Please contact Pink Posts at 859-395-8188 for large adjustments.',
            code: 'self_edit_implausible_diff_blocked',
          },
          { status: 403 }
        )
      }
    }

    // ---- Optimistic concurrency check ----
    // Client sends expected_total = order.total as seen when the edit page
    // loaded. If two admins open the same pending order and both save, the
    // second one's expected_total will mismatch the DB and we 409 them with
    // a "reload" message. Without this guard, the second save silently
    // overwrites the first's items AND computes its diff against the first's
    // post-edit total (wrong baseline → wrong charge). Backwards-compatible:
    // clients that don't send expected_total skip the check (last-write-wins).
    if (editData.expected_total !== undefined) {
      const observedTotal = Number(existingOrder.total)
      if (Math.abs(observedTotal - editData.expected_total) > 0.01) {
        return NextResponse.json(
          {
            error: `This order changed since you opened the edit page (was $${editData.expected_total.toFixed(2)}, now $${observedTotal.toFixed(2)}). Reload the page and re-apply your changes.`,
            code: 'concurrent_edit',
          },
          { status: 409 }
        )
      }
    }

    // Server-side schedule gate. Only apply when the edit actually CHANGES
    // the schedule — otherwise an order placed yesterday couldn't be edited
    // today just because its original date is now in the past.
    const originalDateStr = existingOrder.scheduledDate
      ? existingOrder.scheduledDate.toISOString().slice(0, 10)
      : null
    const newDateStr = editData.requested_date ?? null
    const dateChanged = newDateStr !== originalDateStr
    const expeditedChanged = (editData.is_expedited ?? false) !== existingOrder.isExpedited
    if (dateChanged || expeditedChanged) {
      const scheduleCheck = validateScheduling({
        requestedDate: newDateStr,
        isExpedited: editData.is_expedited ?? existingOrder.isExpedited,
      })
      if (!scheduleCheck.ok) {
        return NextResponse.json(
          { error: scheduleCheck.error, code: scheduleCheck.code },
          { status: 400 }
        )
      }
    }

    // ---- Resolve the post ----
    // post_type is always sent in full-edit mode: a post name, 'open_house', or
    // 'none'/'' for no post (service trip fee applies).
    let newPostTypeId: string | null = null
    let noPostSurcharge = 0
    const pt = editData.post_type
    if (!pt || pt === 'none') {
      newPostTypeId = null
      noPostSurcharge = NO_POST_SURCHARGE
    } else if (pt === 'open_house') {
      newPostTypeId = null
      noPostSurcharge = 0
    } else {
      const postType = await prisma.postType.findFirst({ where: { name: pt } })
      if (!postType) {
        return NextResponse.json({ error: `Invalid post type: ${pt}` }, { status: 400 })
      }
      newPostTypeId = postType.id
      noPostSurcharge = 0
    }

    // ---- Recompute pricing ----
    // The diff between this new total and the existing order.total is charged
    // (or credit-flagged, or invoice-folded) at save time below — search for
    // "chargeOutcome" — so admins don't have to chase the gap manually.
    // CR4 (Round 22): a flat-fee order stays at the flat total it was placed at
    // (currently $67.09; legacy orders may be $66.07 if placed before the fuel
    // bump on 2026-06-27) — never diff-charged. Clamp money fields (items still
    // replaced below for fulfillment). With subtotal=$60 and the original
    // fuelSurcharge preserved, the tax/total formulas yield the same total the
    // order was charged at, so the diff vs original is $0 and no charge fires.
    const isFlatFee = existingOrder.flatFeeApplied
    if (isFlatFee) noPostSurcharge = 0

    // ---- Preserve admin-added items the customer's form couldn't render ----
    // Server-side defense-in-depth for the inventory-linked round-trip: any
    // existing OrderItem with a customer_*_id NOT in the payload AND NOT in
    // the form's client_aware_inventory set is re-attached unchanged. This
    // prevents data loss when the form silently drops a line it couldn't
    // represent (e.g. a non-catalog rider like "Sarah Arvin" with no
    // customerRider link from the admin-add path).
    //
    // Skipped for admin role (admin's edit is authoritative — if admin omits
    // an item, treat as intentional removal) and skipped when the client did
    // NOT send client_aware_inventory (backwards-compat: an older client that
    // doesn't know about the awareness signal would have every customer_*_id
    // item force-preserved, blocking legitimate removal).
    //
    // Flat-fee orders STILL preserve for fulfillment fidelity (the install
    // crew needs the full items list) even though item totals don't affect
    // the clamped total — the FLAT_FEE_BASE branch below ignores
    // preservedSubtotal so money is unaffected.
    const preservationActive = user.role !== 'admin' && editData.client_aware_inventory !== undefined
    const aware = editData.client_aware_inventory ?? { sign_ids: [], rider_ids: [], lockbox_ids: [], brochure_box_ids: [] }
    const payloadSignIds = new Set(editData.items.map(i => i.customer_sign_id).filter((x): x is string => !!x))
    const payloadRiderIds = new Set(editData.items.map(i => i.customer_rider_id).filter((x): x is string => !!x))
    const payloadLockboxIds = new Set(editData.items.map(i => i.customer_lockbox_id).filter((x): x is string => !!x))
    const payloadBrochureIds = new Set(editData.items.map(i => i.customer_brochure_box_id).filter((x): x is string => !!x))
    const awareSignIds = new Set(aware.sign_ids ?? [])
    const awareRiderIds = new Set(aware.rider_ids ?? [])
    const awareLockboxIds = new Set(aware.lockbox_ids ?? [])
    const awareBrochureIds = new Set(aware.brochure_box_ids ?? [])
    const preserveItems = !preservationActive
      ? []
      : existingOrder.orderItems.filter(item => {
          // OOA service-area surcharge has no customer form UI; always round-
          // trip it so admin's items list still shows the "Out-of-area service
          // fee" line after a customer self-edit.
          if (item.itemType === 'surcharge') return true
          // Inventory-linked items the form was unaware of (couldn't render →
          // couldn't intentionally drop).
          if (item.customerSignId) return !payloadSignIds.has(item.customerSignId) && !awareSignIds.has(item.customerSignId)
          if (item.customerRiderId) return !payloadRiderIds.has(item.customerRiderId) && !awareRiderIds.has(item.customerRiderId)
          if (item.customerLockboxId) return !payloadLockboxIds.has(item.customerLockboxId) && !awareLockboxIds.has(item.customerLockboxId)
          if (item.customerBrochureBoxId) return !payloadBrochureIds.has(item.customerBrochureBoxId) && !awareBrochureIds.has(item.customerBrochureBoxId)
          return false
        })
    const preservedSubtotal = preserveItems.reduce((sum, it) => sum + Number(it.totalPrice), 0)

    // OOA service-area surcharge is preserved from the existing order (locked
    // at placement time — never re-resolved). Normally the surcharge line is
    // picked up by preserveItems above, but if the original surcharge line is
    // somehow missing (legacy data, dropped by an earlier bug), fall back to
    // the locked cents value on the Order row so total still reflects it.
    // Flat-fee orders clear it because the flat total absorbs all fees.
    const preservedSurchargeFromLines = preserveItems
      .filter(it => it.itemType === 'surcharge')
      .reduce((sum, it) => sum + Number(it.totalPrice), 0)
    const lockedSurcharge = isFlatFee ? 0 : (existingOrder.serviceAreaSurchargeCents ?? 0) / 100
    const surchargeShortfall = Math.max(0, lockedSurcharge - preservedSurchargeFromLines)

    const newSubtotal = isFlatFee
      ? FLAT_FEE_BASE
      : editData.items.reduce((sum, item) => sum + item.total_price, 0) + preservedSubtotal + surchargeShortfall

    // Fuel surcharge is ALWAYS preserved from the existing order — never
    // re-priced. Customers shouldn't be hit with retroactive fuel-rate hikes
    // just because they edited an order placed at the old rate. This applies
    // uniformly to flat-fee and non-flat-fee orders.
    const fuelSurcharge = Number(existingOrder.fuelSurcharge)
    // Expedite fee follows the (editable) scheduling selection (0 when flat-fee).
    const expediteFee = isFlatFee ? 0 : (editData.is_expedited ? EXPEDITE_FEE : 0)

    // Recompute discount from the order's existing promo code (promo can't be
    // changed during an edit).
    let discount = 0
    if (existingOrder.promoCode && existingOrder.promoCode.isActive) {
      if (existingOrder.promoCode.discountType === 'percentage') {
        discount = newSubtotal * (Number(existingOrder.promoCode.discountValue) / 100)
      } else {
        discount = Math.min(Number(existingOrder.promoCode.discountValue), newSubtotal)
      }
      discount = Math.round(discount * 100) / 100
    }

    if (isFlatFee) discount = 0
    const discountedSubtotal = Math.max(0, newSubtotal - discount)
    // Tax base EXCLUDES any itemType 'surcharge' line AND any shortfall
    // surcharge added back from the locked value. Everything else taxable
    // stays in: regular items, preserved inventory items, expedite fee,
    // no-post service-trip fee. Fuel surcharge is excluded as before. KY
    // non-taxable rule: pure service charges with no physical post attached
    // aren't sales-taxable (matches commit a047770 for standalone service
    // trips). Ryan 2026-06-29: confirmed OOA fee follows the same rule.
    const nonTaxableItemTotal = editData.items
      .filter(i => i.item_type === 'surcharge' as never)
      .reduce((sum, i) => sum + i.total_price, 0)
      + preservedSurchargeFromLines
      + surchargeShortfall
    const taxableAmount = Math.max(0, discountedSubtotal - nonTaxableItemTotal) + expediteFee + noPostSurcharge
    const tax = Math.round(taxableAmount * FALLBACK_TAX_RATE * 100) / 100
    const total = discountedSubtotal + fuelSurcharge + expediteFee + noPostSurcharge + tax

    // ---- Inventory bookkeeping ----
    // All existing line items are being replaced. Restore any inventory they
    // referenced back to inStorage:true, UNLESS the new items reference them too
    // (then they stay out). Then lock everything the new items reference.
    // Preserved items also count as "still referenced" — their inventory must
    // stay locked since they remain on the order post-edit.
    const newSignIds = payloadSignIds
    const newRiderIds = payloadRiderIds
    const newLockboxIds = payloadLockboxIds
    const newBrochureIds = payloadBrochureIds
    const preservedSignIds = new Set(preserveItems.map(i => i.customerSignId).filter((x): x is string => !!x))
    const preservedRiderIds = new Set(preserveItems.map(i => i.customerRiderId).filter((x): x is string => !!x))
    const preservedLockboxIds = new Set(preserveItems.map(i => i.customerLockboxId).filter((x): x is string => !!x))
    const preservedBrochureIds = new Set(preserveItems.map(i => i.customerBrochureBoxId).filter((x): x is string => !!x))

    const idsToRestore = {
      signs: existingOrder.orderItems.map(i => i.customerSignId).filter((x): x is string => !!x && !newSignIds.has(x) && !preservedSignIds.has(x)),
      riders: existingOrder.orderItems.map(i => i.customerRiderId).filter((x): x is string => !!x && !newRiderIds.has(x) && !preservedRiderIds.has(x)),
      lockboxes: existingOrder.orderItems.map(i => i.customerLockboxId).filter((x): x is string => !!x && !newLockboxIds.has(x) && !preservedLockboxIds.has(x)),
      brochureBoxes: existingOrder.orderItems.map(i => i.customerBrochureBoxId).filter((x): x is string => !!x && !newBrochureIds.has(x) && !preservedBrochureIds.has(x)),
    }

    // Resolve property fields, falling back to the existing order when omitted.
    const propertyType = editData.property_type ?? existingOrder.propertyType
    if (!VALID_PROPERTY_TYPES.includes(propertyType)) {
      return NextResponse.json({ error: `Invalid property type: ${propertyType}` }, { status: 400 })
    }

    const scheduledDate = editData.requested_date
      ? new Date(editData.requested_date + 'T12:00:00Z')
      : null

    // Resolve the effective payer ONCE before the transaction. For
    // team_admin-on-behalf-of orders the agent is `userId` but the team_admin
    // is `placedByUserId` and was the human whose card was originally charged
    // — so any diff charge must hit the team_admin's wallet, not the agent's.
    const payer = await resolveEffectivePayer({
      userId: existingOrder.userId,
      placedByUserId: existingOrder.placedByUserId,
    })

    let raceLost = false
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Replace ALL line items (the post is included in items[] as item_type
      // 'post', mirroring order creation)
      await tx.orderItem.deleteMany({ where: { orderId: id } })

      await tx.orderItem.createMany({
        data: editData.items.map((item) => ({
          orderId: id,
          itemType: item.item_type,
          itemCategory: item.item_category || null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          totalPrice: item.total_price,
          customerSignId: item.customer_sign_id || null,
          customerRiderId: item.customer_rider_id || null,
          customerLockboxId: item.customer_lockbox_id || null,
          customerBrochureBoxId: item.customer_brochure_box_id || null,
          customValue: item.custom_value || null,
        })),
      })

      // Re-attach preserved items (the form silently dropped these — see the
      // preserveItems computation above for the heuristic). Re-emit with the
      // same shape, just minted as a fresh row since the original was wiped
      // by the deleteMany above.
      if (preserveItems.length > 0) {
        await tx.orderItem.createMany({
          data: preserveItems.map((item) => ({
            orderId: id,
            itemType: item.itemType,
            itemCategory: item.itemCategory,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            customerSignId: item.customerSignId,
            customerRiderId: item.customerRiderId,
            customerLockboxId: item.customerLockboxId,
            customerBrochureBoxId: item.customerBrochureBoxId,
            customValue: item.customValue,
          })),
        })
      }

      // Materialize a surcharge line when surchargeShortfall > 0 and no
      // surcharge line is present in either the payload or preserveItems.
      // This catches the admin-edit case (preservation disabled) and the
      // legacy-data case (Order has serviceAreaSurchargeCents > 0 but no
      // matching surcharge OrderItem). Without this, the new total includes
      // the OOA cents but sum(orderItems) does not — admin order detail and
      // the bundled invoice from a047770 would show subtotal > line-item
      // sum with no line to explain the gap.
      const hasSurchargeInPayload = editData.items.some(i => (i.item_type as string) === 'surcharge')
      const hasSurchargeInPreserved = preserveItems.some(it => it.itemType === 'surcharge')
      if (surchargeShortfall > 0 && !hasSurchargeInPayload && !hasSurchargeInPreserved) {
        const original = existingOrder.orderItems.find(it => it.itemType === 'surcharge')
        await tx.orderItem.create({
          data: {
            orderId: id,
            itemType: 'surcharge',
            itemCategory: original?.itemCategory ?? null,
            description: original?.description ?? `Out-of-area service fee (preserved)`,
            quantity: 1,
            unitPrice: surchargeShortfall,
            totalPrice: surchargeShortfall,
            customValue: original?.customValue ?? null,
          },
        })
      }

      // Restore inventory referenced only by the OLD order
      if (idsToRestore.signs.length)
        await tx.customerSign.updateMany({ where: { id: { in: idsToRestore.signs } }, data: { inStorage: true } })
      if (idsToRestore.riders.length)
        await tx.customerRider.updateMany({ where: { id: { in: idsToRestore.riders } }, data: { inStorage: true } })
      if (idsToRestore.lockboxes.length)
        await tx.customerLockbox.updateMany({ where: { id: { in: idsToRestore.lockboxes } }, data: { inStorage: true } })
      if (idsToRestore.brochureBoxes.length)
        await tx.customerBrochureBox.updateMany({ where: { id: { in: idsToRestore.brochureBoxes } }, data: { inStorage: true } })

      // Lock inventory referenced by the NEW order (idempotent)
      if (newSignIds.size)
        await tx.customerSign.updateMany({ where: { id: { in: Array.from(newSignIds) } }, data: { inStorage: false } })
      if (newRiderIds.size)
        await tx.customerRider.updateMany({ where: { id: { in: Array.from(newRiderIds) } }, data: { inStorage: false } })
      if (newLockboxIds.size)
        await tx.customerLockbox.updateMany({ where: { id: { in: Array.from(newLockboxIds) } }, data: { inStorage: false } })
      if (newBrochureIds.size)
        await tx.customerBrochureBox.updateMany({ where: { id: { in: Array.from(newBrochureIds) } }, data: { inStorage: false } })

      // Race-safe: invoice-bundle job (admin/invoices) can stamp invoiceId on
      // a pending order at any moment via updateMany({ invoiceId: null }).
      // updateMany with the same predicate here returns count=0 if the bundler
      // raced us, in which case we throw to roll back the whole transaction
      // (orderItem deletes, inventory swaps) and 409 the caller.
      const updateResult = await tx.order.updateMany({
        where: { id, invoiceId: null },
        data: {
          postTypeId: newPostTypeId,
          // Property
          propertyType: propertyType as never,
          propertyAddress: editData.property_address ?? existingOrder.propertyAddress,
          propertyCity: editData.property_city ?? existingOrder.propertyCity,
          propertyState: editData.property_state ?? existingOrder.propertyState,
          propertyZip: editData.property_zip ?? existingOrder.propertyZip,
          installationLocation: editData.installation_location ?? existingOrder.installationLocation,
          installationLocationImage: editData.installation_location_image ?? existingOrder.installationLocationImage,
          propertyNotes: editData.installation_notes ?? existingOrder.propertyNotes,
          isGatedCommunity: editData.is_gated_community ?? existingOrder.isGatedCommunity,
          gateCode: editData.gate_code ?? existingOrder.gateCode,
          hasMarkerPlaced: editData.has_marker_placed ?? existingOrder.hasMarkerPlaced,
          signOrientation: editData.sign_orientation ?? existingOrder.signOrientation,
          signOrientationOther: editData.sign_orientation_other ?? existingOrder.signOrientationOther,
          // Scheduling
          scheduledDate,
          isExpedited: editData.is_expedited ?? existingOrder.isExpedited,
          // Pricing
          subtotal: newSubtotal,
          noPostSurcharge,
          expediteFee,
          discount,
          tax,
          total,
        },
      })
      if (updateResult.count === 0) {
        // Bundler beat us. Mark for the outer 409 and roll back the tx by throwing.
        raceLost = true
        throw new Error('INVOICE_BUNDLE_RACE')
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id },
        include: { orderItems: true, postType: true },
      })
      return order
    }).catch((err) => {
      if (raceLost) return null
      throw err
    })

    if (!updatedOrder) {
      return NextResponse.json(
        { error: 'Error: order already invoiced. Please contact 859-395-8188 to make changes.' },
        { status: 409 }
      )
    }

    console.log(
      `Edited order ${updatedOrder.orderNumber}: restored ${idsToRestore.signs.length} signs, ${idsToRestore.riders.length} riders, ${idsToRestore.lockboxes.length} lockboxes, ${idsToRestore.brochureBoxes.length} brochures; locked ${newSignIds.size} signs, ${newRiderIds.size} riders, ${newLockboxIds.size} lockboxes, ${newBrochureIds.size} brochures; new total $${total.toFixed(2)}`
    )

    // ---- Charge / credit the diff ----
    // Per Ryan: regular customers should be auto-charged the positive diff at
    // admin-save time; invoice-billing customers' edits roll up into their
    // next invoice; negative diffs are logged as credit_pending so admin can
    // issue the refund manually via Stripe (auto-refund is a v2). Rounded to
    // cents to avoid 0.001-style float drift triggering nuisance Stripe calls.
    //
    // Source of truth precedence:
    //   1. order.paymentStatus === 'pending_invoice' → invoice-billing skip
    //      (regardless of user.invoiceBilling, which is mutable post-creation
    //      and would otherwise double-bill a customer whose flag flipped)
    //   2. order.paymentStatus !== 'succeeded' AND diff > 0 → flag for manual
    //      collection: the original wasn't paid so charging just the diff
    //      would leave the original total unbilled
    //   3. diff < 0 → accumulate into pendingCreditCents; admin refunds
    //      manually via Stripe dashboard. Stays on the order as the running
    //      refund-owed balance — admin reconciles via Stripe.
    //   4. diff > 0 → charge the FULL positive diff to the EFFECTIVE PAYER's
    //      card (team_admin if on-behalf-of, else order owner) with an
    //      idempotency key keyed on (orderId, originalCents, newCents) so
    //      double-saves collapse. NO netting against pendingCreditCents —
    //      that was removed 2026-06-29 because it created a refund-replay
    //      window (edit cheaper → admin manual refund → edit back → diff
    //      eaten by stale pendingCreditCents → customer pocketed refund).
    //      Do NOT add netting back; admin reconciles manually instead.
    const originalTotalCents = Math.round(Number(existingOrder.total) * 100)
    const newTotalCents = Math.round(Number(updatedOrder.total) * 100)
    const originalTotal = originalTotalCents / 100
    const diff = (newTotalCents - originalTotalCents) / 100
    const existingPendingCreditCents = existingOrder.pendingCreditCents

    let chargeOutcome: EditChargeOutcome = { kind: 'no_change' }
    let newEditChargeStatus: 'no_change' | 'charged_diff' | 'charge_failed' | 'credit_pending' | 'no_payment_method' | 'invoice_billing_skip' = 'no_change'
    let newLastEditPaymentIntentId: string | null = null
    let newEditChargeLastError: string | null = null
    let newLastEditChargedAt: Date | null = null
    let pendingCreditCentsAfter = existingPendingCreditCents

    if (diff !== 0) {
      if (existingOrder.paymentStatus === 'pending_invoice') {
        chargeOutcome = { kind: 'invoice_billing_skip', diff }
        newEditChargeStatus = 'invoice_billing_skip'
      } else if (existingOrder.paymentStatus !== 'succeeded' && diff > 0) {
        // Original order never fully paid (failed/pending/processing). Don't
        // try to charge just the diff — leaves the customer underbilled.
        chargeOutcome = { kind: 'no_payment_method', diff }
        newEditChargeStatus = 'no_payment_method'
        newEditChargeLastError = `Original order paymentStatus=${existingOrder.paymentStatus} — never fully collected. Admin must charge the full updated total manually.`
      } else if (diff < 0) {
        pendingCreditCentsAfter = existingPendingCreditCents + Math.round(-diff * 100)
        chargeOutcome = { kind: 'credit_pending', diff, pendingCreditCentsAfter }
        newEditChargeStatus = 'credit_pending'
      } else {
        // diff > 0 and paymentStatus === 'succeeded'. Charge the FULL positive
        // diff to the card on file — no netting against pendingCreditCents.
        // Per Ryan 2026-06-29: each edit should charge fresh based on the
        // order's current total, not be reduced by some accumulated unresolved
        // credit balance. The previous netting created a refund-replay window
        // (edit cheaper → admin issues manual refund → edit back to original
        // → diff charge gets eaten by the stale pendingCreditCents = $0 net
        // → customer pockets the refund) that this design closes. The
        // accumulated pendingCreditCents stays as the admin's running ledger
        // of refunds-to-issue; positive diffs no longer touch it. Admin
        // reconciles any net balance manually via Stripe.
        const diffCents = Math.round(diff * 100)
        pendingCreditCentsAfter = existingPendingCreditCents

        if (!payer || !payer.stripeCustomerId) {
          chargeOutcome = { kind: 'no_payment_method', diff }
          newEditChargeStatus = 'no_payment_method'
          newEditChargeLastError = !payer
            ? 'Could not resolve order payer (orphaned placedByUserId/userId).'
            : `Payer ${payer.email} has no Stripe customer on file.`
        } else {
          const defaultPaymentMethod = await prisma.paymentMethod.findFirst({
            where: { userId: payer.id, isDefault: true },
          })
          if (!defaultPaymentMethod) {
            chargeOutcome = { kind: 'no_payment_method', diff }
            newEditChargeStatus = 'no_payment_method'
            newEditChargeLastError = `${payer.isBroker ? 'Broker' : 'Customer'} ${payer.email} has no card on file.`
          } else {
            // Idempotency key uniquely identifies the (order, before, after)
            // transition — Stripe dedupes within 24h so admin double-clicks
            // / network retries / two-tab races collapse to one PaymentIntent.
            const idempotencyKey = `order-edit-diff:${updatedOrder.id}:${originalTotalCents}:${newTotalCents}`
            try {
              const paymentIntent = await chargePaymentMethod(
                payer.stripeCustomerId,
                defaultPaymentMethod.stripePaymentMethodId,
                diffCents,
                `Order ${updatedOrder.orderNumber} edit — diff charge`,
                {
                  orderId: updatedOrder.id,
                  orderNumber: updatedOrder.orderNumber,
                  kind: 'order_edit_diff',
                  originalTotal: originalTotal.toFixed(2),
                  newTotal: Number(updatedOrder.total).toFixed(2),
                  payerUserId: payer.id,
                },
                idempotencyKey,
              )
              chargeOutcome = {
                kind: 'charged_diff',
                diff,
                paymentIntentId: paymentIntent.id,
                cardLast4: defaultPaymentMethod.last4 ?? null,
                cardBrand: defaultPaymentMethod.brand ?? null,
                // netDiff equals diff and appliedCreditCents is always 0 now
                // that we don't net — kept on the type so consumers (email,
                // dashboard toast) don't need to change.
                netDiff: diff,
                appliedCreditCents: 0,
              }
              newEditChargeStatus = 'charged_diff'
              newLastEditPaymentIntentId = paymentIntent.id
              newLastEditChargedAt = new Date()
            } catch (err) {
              const reason = err instanceof Error ? err.message : 'unknown'
              console.error(`Edit diff charge failed for order ${updatedOrder.orderNumber}:`, err)
              // Detached / dead PM: flip the local row stale so future edits
              // don't keep firing the same broken card. Don't apply credit
              // since we didn't actually charge.
              if (isDetachedPaymentMethodError(err)) {
                try {
                  await prisma.paymentMethod.update({
                    where: { id: defaultPaymentMethod.id },
                    data: { isDefault: false },
                  })
                  console.warn(`Marked stale PaymentMethod ${defaultPaymentMethod.id} for user ${payer.id} (detached/declined at Stripe)`)
                } catch (markErr) {
                  console.error('Failed to mark detached PM stale:', markErr)
                }
                chargeOutcome = { kind: 'no_payment_method', diff }
                newEditChargeStatus = 'no_payment_method'
                newEditChargeLastError = `Card on file is no longer usable at Stripe — payer should add a new card. (${reason})`
              } else {
                chargeOutcome = { kind: 'charge_failed', diff, reason }
                newEditChargeStatus = 'charge_failed'
                newEditChargeLastError = reason
              }
              pendingCreditCentsAfter = existingPendingCreditCents
            }
          }
        }
      }
    }
    console.log(`Edit charge outcome for ${updatedOrder.orderNumber}: ${chargeOutcome.kind}${diff !== 0 ? ` (diff $${diff.toFixed(2)}, pendingCreditCents ${existingPendingCreditCents}→${pendingCreditCentsAfter})` : ''}`)

    // Persist chargeOutcome to durable Order columns BEFORE the audit log so
    // a successful Stripe charge always has a queryable trail even if audit
    // logging fails. /admin/orders worklist filters on editChargeStatus to
    // surface charge_failed / no_payment_method / credit_pending orders.
    try {
      await prisma.order.update({
        where: { id: updatedOrder.id },
        data: {
          editChargeStatus: newEditChargeStatus,
          editChargeLastError: newEditChargeLastError,
          lastEditPaymentIntentId: newLastEditPaymentIntentId,
          lastEditChargedAt: newLastEditChargedAt,
          pendingCreditCents: pendingCreditCentsAfter,
        },
      })
    } catch (persistErr) {
      // If this fails after a successful Stripe charge, money moved but
      // local state shows the old status. Log loudly so admin can reconcile
      // via Stripe Dashboard using metadata.orderId.
      console.error(
        `CRITICAL: failed to persist editChargeStatus=${newEditChargeStatus} on order ${updatedOrder.orderNumber}` +
        (newLastEditPaymentIntentId ? ` — Stripe PI ${newLastEditPaymentIntentId} succeeded but is not linked locally.` : ''),
        persistErr,
      )
    }

    // Capture before/after deltas so admin can read the audit log and see
    // exactly what changed. Items array is the most common edit (add/remove
    // line items) so we serialize both sides at low fidelity.
    const beforeSnapshot = {
      total: Number(existingOrder.total),
      subtotal: Number(existingOrder.subtotal),
      propertyNotes: existingOrder.propertyNotes,
      postTypeId: existingOrder.postTypeId,
      items: existingOrder.orderItems.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
      })),
    }
    const afterSnapshot = {
      total: Number(updatedOrder.total),
      subtotal: Number(updatedOrder.subtotal),
      propertyNotes: updatedOrder.propertyNotes,
      postTypeId: updatedOrder.postTypeId,
      items: updatedOrder.orderItems.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
      })),
    }

    try {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.OrderEdit,
        targetType: 'order',
        targetId: updatedOrder.id,
        metadata: {
          orderNumber: updatedOrder.orderNumber,
          before: beforeSnapshot,
          after: afterSnapshot,
          diff,
          chargeOutcome,
        },
        request,
      })
    } catch (auditErr) {
      // Audit failure is non-fatal — don't block the edit response.
      console.error('Edit audit log failed:', auditErr)
    }

    // Re-send the admin notification with the UPDATED order snapshot so
    // install crews don't work off the stale original email. Subject is
    // prefixed "[EDITED]" so admin spots the re-send in their inbox.
    // The original email is NOT recalled — Resend doesn't support that —
    // it just gets superseded by this one.
    //
    // Admin + customer email sends each have their OWN try/catch so a
    // failure in one (Resend hiccup, bounce, rate limit) doesn't suppress
    // the other. For charge_failed / no_payment_method outcomes, BOTH
    // recipients need to see the message — admin to act, customer to know.
    const fullOrder = await prisma.order.findUnique({
      where: { id: updatedOrder.id },
      include: {
        orderItems: true,
        user: true,
        postType: { select: { name: true } },
      },
    })
    if (fullOrder) {
      const assignedAgent = await resolveAssignedAgent({
        placedForAgentName: fullOrder.placedForAgentName,
        teamId: fullOrder.user.teamId,
      })
      try {
        await sendAdminOrderNotification({
          orderNumber: fullOrder.orderNumber,
          customerName: fullOrder.user.fullName || fullOrder.user.name || '',
          customerEmail: fullOrder.user.email,
          customerPhone: fullOrder.user.phone || '',
          propertyAddress: `${fullOrder.propertyAddress}, ${fullOrder.propertyCity}, ${fullOrder.propertyState} ${fullOrder.propertyZip}`,
          total: Number(fullOrder.total),
          items: fullOrder.orderItems.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            total_price: Number(it.totalPrice),
          })),
          requestedDate: fullOrder.scheduledDate?.toISOString(),
          isExpedited: fullOrder.isExpedited,
          propertyType: fullOrder.propertyType ?? undefined,
          postType: fullOrder.postType?.name || undefined,
          installationNotes: fullOrder.propertyNotes || undefined,
          installationLocation: fullOrder.installationLocation || undefined,
          isGatedCommunity: fullOrder.isGatedCommunity,
          gateCode: fullOrder.gateCode || undefined,
          hasMarkerPlaced: fullOrder.hasMarkerPlaced,
          signOrientation: fullOrder.signOrientation || undefined,
          signOrientationOther: fullOrder.signOrientationOther || undefined,
          subtotal: Number(fullOrder.subtotal),
          discount: Number(fullOrder.discount),
          fuelSurcharge: Number(fullOrder.fuelSurcharge),
          noPostSurcharge: Number(fullOrder.noPostSurcharge),
          expediteFee: Number(fullOrder.expediteFee),
          tax: Number(fullOrder.tax),
          assignedAgentName: assignedAgent?.name ?? null,
          assignedAgentPhone: assignedAgent?.phone ?? null,
          isInvoiceBilling: fullOrder.paymentStatus === 'pending_invoice',
          isEdited: true,
          originalTotal,
          editChargeOutcome: chargeOutcome,
        })
      } catch (adminEmailErr) {
        // Admin email failure shouldn't block the customer email below.
        console.error('Admin edit notification email failed:', adminEmailErr)
      }

      try {
        // Customer email send conditions:
        //   1. Admin edited another user's order — original "by support" path
        //   2. ANY edit that moved the customer's wallet (card charged,
        //      credit owed, charge failed, no PM) — they need a receipt.
        //      Without this, a customer self-edit charges their card with
        //      zero confirmation email — a chargeback magnet.
        // For invoice-billing skips (no Stripe call) and no_change (no $
        // delta), self-edits don't get a separate email.
        const isAdminEditingOther = user.role === 'admin' && fullOrder.userId !== user.id
        const isWalletImpact =
          chargeOutcome.kind === 'charged_diff' ||
          chargeOutcome.kind === 'credit_pending' ||
          chargeOutcome.kind === 'charge_failed' ||
          chargeOutcome.kind === 'no_payment_method'

        if (isAdminEditingOther || isWalletImpact) {
          // Route the receipt to the effective PAYER, not always the order
          // owner. For team_admin-on-behalf-of orders, the broker paid and
          // should get the receipt — they're the human accountants will ask.
          // Falls back to order owner when payer == owner (solo customer).
          const useBrokerRecipient = !!payer && payer.id !== fullOrder.userId
          const recipientName = useBrokerRecipient
            ? payer.fullName
            : (fullOrder.user.fullName || fullOrder.user.name || '')
          const recipientEmail = useBrokerRecipient
            ? payer.email
            : fullOrder.user.email
          const recipientUserId = useBrokerRecipient ? payer.id : fullOrder.userId

          await sendOrderConfirmationEmail({
            customerName: recipientName,
            customerEmail: recipientEmail,
            orderNumber: fullOrder.orderNumber,
            propertyAddress: `${fullOrder.propertyAddress}, ${fullOrder.propertyCity}, ${fullOrder.propertyState} ${fullOrder.propertyZip}`,
            total: Number(fullOrder.total),
            items: fullOrder.orderItems.map((it) => ({
              description: it.description,
              quantity: it.quantity,
              total_price: Number(it.totalPrice),
            })),
            requestedDate: fullOrder.scheduledDate?.toISOString(),
            installationNotes: fullOrder.propertyNotes || undefined,
            recipientUserId,
            isInvoiceBilling: fullOrder.paymentStatus === 'pending_invoice',
            isEditedBySupport: isAdminEditingOther,
            isSelfEdited: !isAdminEditingOther,
            originalTotal,
            editChargeOutcome: chargeOutcome,
          })
        }
      } catch (customerEmailErr) {
        console.error('Customer edit notification email failed:', customerEmailErr)
      }
    }

    // Return chargeOutcome so the admin UI can toast a charge_failed /
    // no_payment_method / credit_pending warning rather than a generic
    // success message. /admin/orders/[id]/edit save button reads this.
    return NextResponse.json({
      order: updatedOrder,
      editChargeOutcome: chargeOutcome,
      pendingCreditCents: pendingCreditCentsAfter,
    })
  } catch (error) {
    console.error('Error editing order:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorDetails = process.env.NODE_ENV !== 'production' ? errorMessage : 'Internal server error'
    return NextResponse.json({ error: errorDetails }, { status: 500 })
  }
}
