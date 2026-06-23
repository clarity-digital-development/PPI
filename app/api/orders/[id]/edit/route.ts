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
import { FLAT_FEE_BASE, FUEL_SURCHARGE } from '@/lib/orders/pricing'
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
    // customer self-edits it is NOT acceptable because the diff feeds Stripe.
    // Two specific attack shapes are blocked here as defense-in-depth until
    // server-side price recomputation lands in a follow-up PR:
    //
    //   1. Negative diff (refund manufacture): a customer could submit
    //      items with total_price near 0, producing a large negative diff
    //      that becomes a credit_pending refund obligation against their card.
    //   2. Implausible inflation: a customer could also push the total to
    //      something extreme and either game the netting or simply create
    //      garbage data — blocked by a 2x-of-original sanity bound below.
    //
    // Admin role bypasses both checks (admin can refund or restructure freely).
    if (user.role !== 'admin') {
      const claimedSubtotal = editData.items.reduce((sum, item) => sum + item.total_price, 0)
      const originalTotal = Number(existingOrder.total)
      // Approximate new total before tax/fees just for the sanity bound. Real
      // total recomputation happens further down; this is a fast pre-check.
      const claimedTotalApprox = claimedSubtotal + Number(existingOrder.fuelSurcharge)
      if (claimedTotalApprox < originalTotal) {
        return NextResponse.json(
          {
            error: 'Please contact Pink Posts at 859-395-8188 to remove items from a paid order — self-edits cannot reduce the total.',
            code: 'self_edit_negative_diff_blocked',
          },
          { status: 403 }
        )
      }
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
    // CR4 (Round 22): a flat-fee order stays at the flat $66.07 total on edit —
    // never diff-charged. Clamp the money fields (items are still replaced below
    // for fulfillment). With subtotal=$60 and the other components zeroed, the
    // existing tax/total formulas yield $3.60 tax and a $66.07 total, so the
    // diff vs the original flat total is $0 and no charge is attempted.
    const isFlatFee = existingOrder.flatFeeApplied
    if (isFlatFee) noPostSurcharge = 0
    const newSubtotal = isFlatFee
      ? FLAT_FEE_BASE
      : editData.items.reduce((sum, item) => sum + item.total_price, 0)

    // Fuel surcharge is preserved from the existing order (never re-charged);
    // flat-fee orders always carry the standard $2.47.
    const fuelSurcharge = isFlatFee ? FUEL_SURCHARGE : Number(existingOrder.fuelSurcharge)
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
    const taxableAmount = discountedSubtotal + expediteFee + noPostSurcharge
    const tax = Math.round(taxableAmount * FALLBACK_TAX_RATE * 100) / 100
    const total = discountedSubtotal + fuelSurcharge + expediteFee + noPostSurcharge + tax

    // ---- Inventory bookkeeping ----
    // All existing line items are being replaced. Restore any inventory they
    // referenced back to inStorage:true, UNLESS the new items reference them too
    // (then they stay out). Then lock everything the new items reference.
    const newSignIds = new Set(editData.items.map(i => i.customer_sign_id).filter(Boolean) as string[])
    const newRiderIds = new Set(editData.items.map(i => i.customer_rider_id).filter(Boolean) as string[])
    const newLockboxIds = new Set(editData.items.map(i => i.customer_lockbox_id).filter(Boolean) as string[])
    const newBrochureIds = new Set(editData.items.map(i => i.customer_brochure_box_id).filter(Boolean) as string[])

    const idsToRestore = {
      signs: existingOrder.orderItems.map(i => i.customerSignId).filter((x): x is string => !!x && !newSignIds.has(x)),
      riders: existingOrder.orderItems.map(i => i.customerRiderId).filter((x): x is string => !!x && !newRiderIds.has(x)),
      lockboxes: existingOrder.orderItems.map(i => i.customerLockboxId).filter((x): x is string => !!x && !newLockboxIds.has(x)),
      brochureBoxes: existingOrder.orderItems.map(i => i.customerBrochureBoxId).filter((x): x is string => !!x && !newBrochureIds.has(x)),
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
    //      manually via Stripe dashboard. Stays on the order so the NEXT
    //      positive diff nets against it (no overcharge on add-after-remove)
    //   4. diff > 0 → net against pendingCreditCents first, then charge the
    //      net to the EFFECTIVE PAYER's card (team_admin if on-behalf-of,
    //      else order owner) with an idempotency key keyed on
    //      (orderId, originalCents, newCents) so double-saves collapse
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
        // diff > 0 and paymentStatus === 'succeeded'. Net against any prior
        // unresolved credit so admin doesn't get a double-charge complaint
        // when a remove-then-add edit nets to zero.
        const diffCents = Math.round(diff * 100)
        const creditToApplyCents = Math.min(diffCents, existingPendingCreditCents)
        const netDiffCents = diffCents - creditToApplyCents
        pendingCreditCentsAfter = existingPendingCreditCents - creditToApplyCents

        if (netDiffCents === 0) {
          // Pending credit fully covered the diff — no Stripe call.
          chargeOutcome = {
            kind: 'charged_diff',
            diff,
            paymentIntentId: 'credit_offset',
            cardLast4: null,
            cardBrand: null,
            netDiff: 0,
            appliedCreditCents: creditToApplyCents,
          }
          newEditChargeStatus = 'charged_diff'
          newLastEditChargedAt = new Date()
        } else if (!payer || !payer.stripeCustomerId) {
          chargeOutcome = { kind: 'no_payment_method', diff }
          newEditChargeStatus = 'no_payment_method'
          newEditChargeLastError = !payer
            ? 'Could not resolve order payer (orphaned placedByUserId/userId).'
            : `Payer ${payer.email} has no Stripe customer on file.`
          pendingCreditCentsAfter = existingPendingCreditCents
        } else {
          const defaultPaymentMethod = await prisma.paymentMethod.findFirst({
            where: { userId: payer.id, isDefault: true },
          })
          if (!defaultPaymentMethod) {
            chargeOutcome = { kind: 'no_payment_method', diff }
            newEditChargeStatus = 'no_payment_method'
            newEditChargeLastError = `${payer.isBroker ? 'Broker' : 'Customer'} ${payer.email} has no card on file.`
            pendingCreditCentsAfter = existingPendingCreditCents
          } else {
            // Idempotency key uniquely identifies the (order, before, after)
            // transition — Stripe dedupes within 24h so admin double-clicks
            // / network retries / two-tab races collapse to one PaymentIntent.
            const idempotencyKey = `order-edit-diff:${updatedOrder.id}:${originalTotalCents}:${newTotalCents}`
            try {
              const paymentIntent = await chargePaymentMethod(
                payer.stripeCustomerId,
                defaultPaymentMethod.stripePaymentMethodId,
                netDiffCents,
                `Order ${updatedOrder.orderNumber} edit — diff charge`,
                {
                  orderId: updatedOrder.id,
                  orderNumber: updatedOrder.orderNumber,
                  kind: 'order_edit_diff',
                  originalTotal: originalTotal.toFixed(2),
                  newTotal: Number(updatedOrder.total).toFixed(2),
                  payerUserId: payer.id,
                  appliedCreditCents: creditToApplyCents.toString(),
                },
                idempotencyKey,
              )
              chargeOutcome = {
                kind: 'charged_diff',
                diff,
                paymentIntentId: paymentIntent.id,
                cardLast4: defaultPaymentMethod.last4 ?? null,
                cardBrand: defaultPaymentMethod.brand ?? null,
                netDiff: netDiffCents / 100,
                appliedCreditCents: creditToApplyCents,
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
