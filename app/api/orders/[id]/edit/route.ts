import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { compressImageDataUri } from '@/lib/images/compress'
import { getCurrentUser } from '@/lib/auth-utils'
import { orderItemSchema } from '@/lib/validations'
import { validateScheduling } from '@/lib/scheduling'
import { sendAdminOrderNotification, sendOrderConfirmationEmail } from '@/lib/email'
import { resolveAssignedAgent } from '@/lib/orders/assigned-agent'
import { audit, AuditAction } from '@/lib/audit'
import { chargePaymentMethod, isDetachedPaymentMethodError } from '@/lib/stripe'
import { resolveEffectivePayer } from '@/lib/orders/effective-payer'
import { computeFlatFeePricing, computeOrderPricing, computeDiscountableSubtotal, NO_POST_SURCHARGE, postRentalApplies, type OrderItemForPricing } from '@/lib/orders/pricing'
import { applyPickupFeePolicy, lockedPickupFeeDecision } from '@/lib/orders/pickup-fee'
import { isPickupFeeWaivedForPayer } from '@/lib/orders/pickup-fee-waiver'
import { allowedInventoryOwnerIds, checkInventoryOwnership, describeInventoryFailures } from '@/lib/orders/inventory-ownership'
import { resolveServiceArea } from '@/lib/service-area'
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
  street_numbers_visible: z.boolean().optional(),
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
    // Ryan's ask). team_admins can edit their own on-behalf-of orders (they're
    // the wallet holder via placedByUserId) — mirrors the GET route's OR
    // condition; without this, a team_admin who placed an OOA order sees it in
    // their dashboard but hits 404 on Edit. The audit log at the end already
    // records actor.role, so all three edit shapes are distinguishable.
    const existingOrder = await prisma.order.findFirst({
      where:
        user.role === 'admin'
          ? { id }
          : user.role === 'team_admin'
            ? { id, OR: [{ userId: user.id }, { placedByUserId: user.id }] }
            : { id, userId: user.id },
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

    // Already-invoiced orders are EDITABLE (Ryan, 2026-07-29) but their money
    // columns are frozen: the sent invoice's page and PDF re-read order rows
    // live, so writing new totals would silently rewrite an invoice the
    // customer already has. Instead this edit's price delta is INCREMENTED
    // onto postInvoiceAdjustmentCents and swept onto the customer's next
    // invoice as its own line. Items/date/property still update normally —
    // that's what the edit is FOR (replaced a hard 409 telling people to call).
    //
    // The invoice-bundle job can still attach invoiceId between here and the
    // transaction below, so the tx.order.updateMany re-checks invoiceId is
    // UNCHANGED from what we read (null-to-bundled race → 409 like before).
    const wasInvoiced = !!existingOrder.invoiceId

    const body = await request.json()
    const validationResult = editOrderSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const editData = validationResult.data

    // ---- Sign-pickup fee ----
    // Re-derived from the sign lines the form re-sent, never taken from the
    // client, and never preserved from the old row (preserveItems below only
    // keeps 'surcharge' and inventory-linked lines). The form always re-sends
    // the pickup sign line — orderToFormData reads it back — so a date-only
    // edit re-adds the identical fee and moves no money.
    //
    // Which fee: if the order ALREADY had a pickup sign, whatever was decided
    // at placement stands (lockedPickupFeeDecision) — so ticking or unticking
    // a team's waiver later never moves $10 on an unrelated edit, the same
    // rule as the OOA exempt-promotion guard below. Only an edit that adds the
    // order's first pickup consults the waiver, and then it is the WALLET's
    // (like the OOA exemption), so an admin editing a waived broker's order
    // still gets the broker's waiver.
    const pickupPolicy = applyPickupFeePolicy(
      editData.items,
      lockedPickupFeeDecision(existingOrder.orderItems) ?? {
        waived: await isPickupFeeWaivedForPayer(existingOrder.placedByUserId ?? existingOrder.userId),
      },
    )
    if (pickupPolicy.error) {
      return NextResponse.json({ error: pickupPolicy.error, code: 'pickup_address_required' }, { status: 400 })
    }
    editData.items = pickupPolicy.items

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

    // Keep recurring post-rental in step with the post this edit lands on. The
    // create paths compute this via postRentalApplies; the edit path never
    // touched the flag at all, so an order edited ONTO "My Own Post" or an open
    // house kept rent accruing on a post PPI doesn't own, and one edited OFF
    // them kept rent switched off forever. Note 'none'/'' must normalise to
    // null — postRentalApplies would read the literal string 'none' as a real
    // post name.
    const newPostRentalDisabled = !postRentalApplies(!pt || pt === 'none' ? null : pt)

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

    // ---- Re-resolve service area when address changed ----
    // Round 27 (per Tanner 2026-07-06): if the customer edits FROM an
    // OOA zip TO an in-area address (or vice versa) we must re-run the
    // service-area resolver so the fee moves accordingly. Previously
    // the OOA charge was locked at placement — a customer stuck with
    // Andi's $50 could not remove it by editing their address to
    // Lexington, and inversely someone editing INTO an unserved area
    // bypassed the block entirely. Flat-fee accounts stay exempt
    // regardless of address per Ryan's policy.
    //
    // Trigger: any of property_address / property_city / property_state
    // / property_zip changed AND not flat-fee AND payer is not exempt.
    // resolveServiceArea handles the exempt fast-path internally, but
    // we still short-circuit when isFlatFee so we don't waste a Google
    // Routes call on flat-fee edits.
    //
    // Empty-string coerce (adversarial review 2026-07-06): the wizard's
    // form state defaults these to '' and a customer can clear a field
    // then navigate to Review via numbered nav. Without coercing '' →
    // undefined, `??` doesn't fall back to the DB value and we (a)
    // trigger a spurious re-resolve on blank submit, (b) 400 with "we
    // don't currently service ZIP ." (empty), and (c) stamp '' into the
    // Order row's address columns overwriting real data.
    const zipInput = editData.property_zip?.trim() || undefined
    const streetInput = editData.property_address?.trim() || undefined
    const cityInput = editData.property_city?.trim() || undefined
    const stateInput = editData.property_state?.trim() || undefined
    const zipChanged = zipInput !== undefined && zipInput !== existingOrder.propertyZip
    const streetChanged = streetInput !== undefined && streetInput !== existingOrder.propertyAddress
    const cityChanged = cityInput !== undefined && cityInput !== existingOrder.propertyCity
    const stateChanged = stateInput !== undefined && stateInput !== existingOrder.propertyState
    const propertyLocationChanged = zipChanged || streetChanged || cityChanged || stateChanged

    // Payer for OOA is the wallet holder — mirrors create route (line 169-173).
    // For self-edits actor === payer; for admin-editing-other the OOA exemption
    // still belongs to the WALLET, not the acting admin.
    const payerForOOA = await prisma.user.findUnique({
      where: { id: existingOrder.placedByUserId ?? existingOrder.userId },
      // invoiceBilling / flatFeeBilling decide whether the fee splits 50/50,
      // exactly as they do at create time.
      select: { id: true, role: true, isServiceAreaExempt: true, invoiceBilling: true, flatFeeBilling: true },
    })

    // Exempt-promotion guard (adversarial review 2026-07-06): if the payer
    // is NOW exempt (admin toggled isServiceAreaExempt) and the order was
    // placed with a locked OOA surcharge, skip the re-resolve so we don't
    // silently zero-out the historical charge and accrue a phantom refund in
    // pendingCreditCents. Address-into-standard for a still-non-exempt
    // customer still fires correctly. If Ryan explicitly wants retroactive
    // refunds for promoted customers, undo this guard — but the default
    // matches his tight-refund pattern.
    //
    // MUST mirror lib/service-area.ts's fast path exactly: ONLY the
    // per-account flag exempts. It used to also match role === 'team_admin',
    // which was harmless while brokers could never carry a surcharge — but the
    // moment they can (2026-09-19), it meant every broker order silently
    // skipped re-resolving on an address change, freezing the fee from the
    // original address in both directions.
    const wouldFastPathExempt = !!payerForOOA && payerForOOA.isServiceAreaExempt
    const hadPaidSurcharge = (existingOrder.serviceAreaSurchargeCents ?? 0) > 0
    const skipReresolveForExemptPromoted = wouldFastPathExempt && hadPaidSurcharge

    let resolvedSurchargeCents: number | null = null
    let resolvedCenterId: string | null | undefined = undefined
    let resolvedDriveMinutes: number | null | undefined = undefined
    let resolvedDriveMiles: number | null | undefined = undefined
    let resolvedSecondChargeCents: number | null | undefined = undefined
    let resolvedSecondChargeStatus: 'pending' | null | undefined = undefined
    let resolvedDriveTimeSource: string | null | undefined = undefined
    if (propertyLocationChanged && !isFlatFee && !skipReresolveForExemptPromoted) {
      const newZip = zipInput ?? existingOrder.propertyZip
      const newStreet = streetInput ?? existingOrder.propertyAddress
      const newCity = cityInput ?? existingOrder.propertyCity
      const newState = stateInput ?? existingOrder.propertyState
      const sa = await resolveServiceArea({
        zip: newZip,
        user: payerForOOA
          ? { id: payerForOOA.id, role: payerForOOA.role, isServiceAreaExempt: payerForOOA.isServiceAreaExempt ?? false }
          : null,
        address: { street: newStreet, city: newCity, state: newState, zip: newZip },
      })
      if (sa.tier === 'out_of_area') {
        return NextResponse.json(
          {
            error: `We don't currently service ZIP ${newZip}. Please call ${sa.contactPhone} to discuss options.`,
            code: 'service_area_unavailable',
            contactPhone: sa.contactPhone,
          },
          { status: 400 }
        )
      }
      // THE INSTALL HALF ONLY — mirroring what create stores.
      //
      // sa.surchargeCents is the BOTH-TRIPS total. app/api/orders/route.ts
      // deliberately writes only the half that lands in this order's OrderItem
      // into Order.serviceAreaSurchargeCents, because that column is the
      // ground truth this route reconciles against. Assigning the full total
      // here made an address edit re-price the order at install+pickup while
      // serviceAreaSecondChargeCents still held the pickup half — so the
      // customer paid the pickup portion twice (once folded into the edit
      // diff, once when removal was scheduled). Harmless-looking while every
      // fee was a flat $50/$25; with per-mile pricing the doubled amount
      // scales with distance.
      const oooSkipsSplit = !!payerForOOA && (payerForOOA.invoiceBilling || payerForOOA.flatFeeBilling)
      const resolvedFullCents = sa.tier === 'surcharge' ? sa.surchargeCents : 0
      resolvedSurchargeCents = oooSkipsSplit
        ? resolvedFullCents
        : Math.round(resolvedFullCents / 2)
      // Re-arm the pickup half for the NEW address too — it used to keep the
      // old address's amount forever. Never touched once it has already been
      // collected ('paid') or hard-failed: re-arming a settled charge would
      // bill the customer a second time.
      if (existingOrder.serviceAreaSecondChargeStatus !== 'paid' && existingOrder.serviceAreaSecondChargeStatus !== 'failed') {
        const secondHalf = oooSkipsSplit ? 0 : resolvedFullCents - resolvedSurchargeCents
        resolvedSecondChargeCents = secondHalf > 0 ? secondHalf : null
        resolvedSecondChargeStatus = secondHalf > 0 ? 'pending' : null
      }
      resolvedCenterId = sa.decidedBy?.centerId ?? null
      resolvedDriveMinutes = sa.decidedBy?.driveTimeMinutes ?? null
      resolvedDriveMiles = sa.decidedBy?.driveMiles ?? null
      resolvedDriveTimeSource = sa.decidedBy?.driveTimeSource ?? null
    }

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
          // OOA service-area surcharge has no customer form UI; round-trip it
          // so admin's items list still shows the fee line after a customer
          // self-edit — UNLESS we re-resolved OOA above, in which case the
          // resolved value is canonical and the old line must be dropped so
          // a stale $50 doesn't stick around when the new tier is 'standard'.
          if (item.itemType === 'surcharge') return resolvedSurchargeCents === null
          // Inventory-linked items the form was unaware of (couldn't render →
          // couldn't intentionally drop).
          if (item.customerSignId) return !payloadSignIds.has(item.customerSignId) && !awareSignIds.has(item.customerSignId)
          if (item.customerRiderId) return !payloadRiderIds.has(item.customerRiderId) && !awareRiderIds.has(item.customerRiderId)
          if (item.customerLockboxId) return !payloadLockboxIds.has(item.customerLockboxId) && !awareLockboxIds.has(item.customerLockboxId)
          if (item.customerBrochureBoxId) return !payloadBrochureIds.has(item.customerBrochureBoxId) && !awareBrochureIds.has(item.customerBrochureBoxId)
          return false
        })
    // Locked-surcharge source of truth:
    //   - Flat-fee: 0 (flat total absorbs all fees).
    //   - Re-resolved on this edit (address/zip changed, non-flat-fee):
    //     resolvedSurchargeCents wins — the resolver just measured the new
    //     address and its answer is canonical.
    //   - Else: existing serviceAreaSurchargeCents (locked at placement).
    // The synthetic-shortfall / surcharge-line injection logic below then
    // makes sure the OrderItems reflect the locked value, whether it came
    // from preservation, the resolver, or the fallback.
    const preservedSurchargeFromLines = preserveItems
      .filter(it => it.itemType === 'surcharge')
      .reduce((sum, it) => sum + Number(it.totalPrice), 0)
    const lockedSurchargeCents = isFlatFee
      ? 0
      : (resolvedSurchargeCents !== null
          ? resolvedSurchargeCents
          : (existingOrder.serviceAreaSurchargeCents ?? 0))
    const lockedSurcharge = lockedSurchargeCents / 100
    const surchargeShortfall = Math.max(0, lockedSurcharge - preservedSurchargeFromLines)

    // Unified items array for the shared pricing helper. Three sources:
    //   - editData.items: what the customer's form sent
    //   - preserveItems: server-preserved admin-added riders + original
    //     surcharge OrderItem (b6099f2 / 8e1c6e1 fix)
    //   - synthetic shortfall: when the locked OOA cents > preserved lines
    //     (rare; usually 0), inject a synthetic surcharge so the total
    //     reflects the locked value even when the OrderItem is missing.
    // The helper's tax-base logic excludes itemType='surcharge' so the OOA
    // fee rides into subtotal + total but never into the tax base.
    const pricingItems: OrderItemForPricing[] = [
      ...editData.items.map(i => ({
        item_type: i.item_type as string,
        item_category: i.item_category,
        total_price: i.total_price,
      })),
      ...preserveItems.map(it => ({
        item_type: it.itemType,
        item_category: it.itemCategory ?? undefined,
        total_price: Number(it.totalPrice),
      })),
      ...(surchargeShortfall > 0
        ? [{ item_type: 'surcharge', total_price: surchargeShortfall }]
        : []),
    ]

    // Discount logic — shared eligible-subtotal with the create route via
    // computeDiscountableSubtotal (excludes brochure_box+purchase). Pre-Round
    // 27 edit used `newSubtotal` directly, which silently shifted the discount
    // every time customer had a brochure-box-purchase line. Standardized
    // 2026-06-30 per the QA sweep.
    //
    // Promo-deactivation policy: if the original promo is no longer active
    // but the order has a saved discount, preserve the dollar amount (clamped
    // to current eligible subtotal). Without this, a customer who edits after
    // admin deactivates their code silently loses the discount and gets
    // re-charged — Ryan's preference is "customer keeps the promo they got".
    const discountForItems = (items: OrderItemForPricing[]): number => {
      if (isFlatFee) return 0
      const base = computeDiscountableSubtotal(items)
      let d = 0
      if (existingOrder.promoCode && existingOrder.promoCode.isActive) {
        if (existingOrder.promoCode.discountType === 'percentage') {
          d = base * (Number(existingOrder.promoCode.discountValue) / 100)
        } else {
          d = Math.min(Number(existingOrder.promoCode.discountValue), base)
        }
      } else if (existingOrder.promoCode && Number(existingOrder.discount) > 0) {
        d = Math.min(Number(existingOrder.discount), base)
      }
      return Math.round(d * 100) / 100
    }
    const discount = discountForItems(pricingItems)

    // Flat-fee short-circuits to the canonical flat breakdown. Non-flat-fee
    // routes through the shared helper, which mirrors the create route's math
    // exactly — preventing the create/edit drift that the QA sweep flagged.
    // `fuelSurchargeOverride` preserves the LOCKED rate from the order's
    // original placement so legacy customers don't pay retroactive bumps.
    const hasPostType = !!editData.post_type && editData.post_type !== 'none'
    // One derivation shared by pricing AND the DB write below (which already
    // uses this ?? form): a PATCH that omits the optional is_expedited field
    // must price the state the row will actually keep, not silently price as
    // non-expedited while the column stays true — that mismatch fed phantom
    // credits into the post-invoice adjustment baseline.
    const effectiveIsExpedited = editData.is_expedited ?? existingOrder.isExpedited
    const pricing = isFlatFee
      ? computeFlatFeePricing(Number(existingOrder.fuelSurcharge), Number(existingOrder.subtotal))
      : computeOrderPricing({
          items: pricingItems,
          hasPostType,
          isExpedited: effectiveIsExpedited,
          discount,
          fuelSurchargeOverride: Number(existingOrder.fuelSurcharge),
        })

    const newSubtotal = pricing.subtotal
    const fuelSurcharge = pricing.fuelSurcharge
    const expediteFee = pricing.expediteFee
    const tax = pricing.tax
    const total = pricing.total

    // ---- Post-invoice adjustment delta (invoiced orders only) ----
    // The frozen Order.total can't be the baseline: it may embed Stripe-Tax
    // pricing from create time, while this recompute uses the flat KY rate —
    // diffing against it would put phantom tax-drift cents on the customer's
    // next invoice for a date-only edit. Instead, price the PRE-EDIT items
    // through the SAME pipeline (same promo rules, same fuel lock, same flat
    // 6%) and take the delta of the two recomputes: identical items cancel to
    // exactly zero, and only what this edit actually changed carries through.
    // The delta is INCREMENTED onto postInvoiceAdjustmentCents (not SET), so
    // a bundler sweep racing this edit stays correct — the sweep zeroes the
    // column and bills what it read; this edit's own delta then lands on the
    // zeroed column and waits for the next sweep. A retried identical PATCH
    // prices old===new and increments zero.
    let postInvoiceAdjustmentDeltaCents = 0
    let newPostInvoiceBaselineCents: number | null = null
    if (wasInvoiced) {
      const oldPricingItems: OrderItemForPricing[] = existingOrder.orderItems.map((it) => ({
        item_type: it.itemType,
        item_category: it.itemCategory ?? undefined,
        total_price: Number(it.totalPrice),
      }))
      // Symmetric surcharge shortfall: the NEW side injects a synthetic
      // surcharge when the locked column exceeds the surcharge OrderItems.
      // Mirror the exact construction on the OLD side (against the pre-edit
      // column) so a legacy column/items mismatch prices identically on both
      // sides of the delta instead of surfacing as a phantom adjustment.
      const oldSurchargeFromLines = oldPricingItems
        .filter((it) => it.item_type === 'surcharge')
        .reduce((s, it) => s + it.total_price, 0)
      const oldLockedSurcharge = isFlatFee ? 0 : (existingOrder.serviceAreaSurchargeCents ?? 0) / 100
      const oldShortfall = Math.max(0, oldLockedSurcharge - oldSurchargeFromLines)
      if (oldShortfall > 0) {
        oldPricingItems.push({ item_type: 'surcharge', total_price: oldShortfall })
      }
      const oldPricing = isFlatFee
        ? computeFlatFeePricing(Number(existingOrder.fuelSurcharge), Number(existingOrder.subtotal))
        : computeOrderPricing({
            items: oldPricingItems,
            // NOT !!existingOrder.postTypeId: open_house orders persist
            // postTypeId=null yet were PRICED as hasPostType=true (no $40
            // no-post fee). The stored noPostSurcharge is the only faithful
            // record of which way the order was actually priced — zero means
            // the $40 fee was not charged, so the baseline must not add it.
            hasPostType: Number(existingOrder.noPostSurcharge) === 0,
            isExpedited: existingOrder.isExpedited,
            discount: discountForItems(oldPricingItems),
            fuelSurchargeOverride: Number(existingOrder.fuelSurcharge),
          })
      // Anchor semantics: after the first invoiced edit, the previous edit's
      // recomputed total (stored on the row) is the baseline — measured
      // through the IDENTICAL pipeline as this edit's recompute, so any
      // reconstruction imprecision (frozen columns going stale after a
      // post-ness change, legacy mismatches) can only ever affect the first
      // delta, never compound across edits.
      const baselineCents =
        existingOrder.postInvoiceBaselineCents ?? Math.round(oldPricing.total * 100)
      newPostInvoiceBaselineCents = Math.round(total * 100)
      postInvoiceAdjustmentDeltaCents = newPostInvoiceBaselineCents - baselineCents
    }
    // The helper recomputes noPostSurcharge from hasPostType; for flat-fee it
    // returns 0. Mirror that into the existing variable used by the DB save
    // block below so the downstream consumers don't change.
    noPostSurcharge = pricing.noPostSurcharge

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

    // INVENTORY OWNERSHIP — same gate as the create route. An edit can attach
    // inventory ids just like a placement can, and this path flipped them with
    // an equally blind updateMany. See lib/orders/inventory-ownership.ts.
    const editAllowedOwners = await allowedInventoryOwnerIds({
      orderUserId: existingOrder.userId,
      actorId: user.id,
    })
    // An on-behalf-of order draws on the PLACER's pool — inventory is held
    // under the team_admin's account, not the agent's. Without this, an agent
    // editing an order a broker placed for them is refused their own order's
    // items as "not owned".
    if (existingOrder.placedByUserId) editAllowedOwners.add(existingOrder.placedByUserId)

    // Ids this order already consumed are inStorage:false BY DESIGN — the
    // create route flipped them, and this route only restores them inside the
    // transaction further down. The wizard round-trips them on every save, so
    // the storage precondition must apply to NEWLY-added ids only. Ownership
    // is still enforced for all of them, and a sign out at a DIFFERENT
    // property is still refused.
    const attachedIds = {
      customer_sign_id: new Set(existingOrder.orderItems.map((i) => i.customerSignId).filter((x): x is string => !!x)),
      customer_rider_id: new Set(existingOrder.orderItems.map((i) => i.customerRiderId).filter((x): x is string => !!x)),
      customer_lockbox_id: new Set(existingOrder.orderItems.map((i) => i.customerLockboxId).filter((x): x is string => !!x)),
      customer_brochure_box_id: new Set(existingOrder.orderItems.map((i) => i.customerBrochureBoxId).filter((x): x is string => !!x)),
    }
    const editInventoryFailures = await checkInventoryOwnership(
      editData.items,
      editAllowedOwners,
      {
        alreadyAttached: attachedIds,
        // Pink Posts staff only -- NOT team_admin. They are the escalation path
        // for an order whose inventory ownership moved underneath it (a revoked
        // brokerage link), and their own edit page shows their own inventory,
        // so without this they cannot fix what nobody else can either.
        internalAdmin: user.role === 'admin',
      }
    )
    if (editInventoryFailures.length > 0) {
      console.warn('[orders/edit] inventory ownership check failed', {
        actorId: user.id,
        orderId: id,
        failures: editInventoryFailures.map((f) => ({ field: f.field, id: f.id, reason: f.reason })),
      })
      return NextResponse.json(
        { error: describeInventoryFailures(editInventoryFailures), code: 'inventory_unavailable' },
        { status: 400 }
      )
    }

    // Shrink a newly-attached install-location photo before the tx opens.
    // The edit wizard round-trips the STORED photo back in the PATCH body, so
    // compare against the row first — otherwise adding a note to an order would
    // lossily re-encode a photo nobody touched, a little worse every edit.
    const editedLocationImage =
      editData.installation_location_image === existingOrder.installationLocationImage
        ? editData.installation_location_image
        : await compressImageDataUri(editData.installation_location_image)

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
        // Description precedence: when we just re-resolved OOA on this edit,
        // use the Round 27 canonical label "Out of Area Service Fee" (no ZIP,
        // no drive minutes) — the resolver already computed the new value and
        // any stale text on the original OrderItem would misdescribe it. Else
        // fall back to the original line's description (locked-at-placement
        // legacy behavior) or the "(preserved)" fallback when there's no
        // original at all.
        const description = resolvedSurchargeCents !== null
          ? 'Out of Area Service Fee'
          : (original?.description ?? 'Out-of-area service fee (preserved)')
        await tx.orderItem.create({
          data: {
            orderId: id,
            itemType: 'surcharge',
            itemCategory: original?.itemCategory ?? null,
            description,
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

      // Lock inventory referenced by the NEW order (idempotent).
      //
      // Owner-guarded, matching the create path (orders/route.ts). Without the
      // guard these four flips took any id the transaction reached this far
      // with and forced it out of storage regardless of who owns it now -- so a
      // waived id (one already on this order) could be re-flipped on an account
      // the actor no longer has access to, e.g. after a brokerage revoked their
      // roster link. The ownership check above already rejects ids the actor
      // may not use; this makes the write itself say the same thing, so the two
      // can never drift.
      // Mirrors the ownership check above, INCLUDING its internal-admin
      // bypass. If the guard were stricter than the check, a staff rescue of an
      // order whose inventory ownership moved would pass validation and then
      // silently match zero rows here -- the order saved, the item never
      // locked.
      const lockGuard = (ids: Set<string>) =>
        user.role === 'admin'
          ? { id: { in: Array.from(ids) } }
          : { id: { in: Array.from(ids) }, userId: { in: Array.from(editAllowedOwners) } }
      if (newSignIds.size)
        await tx.customerSign.updateMany({ where: lockGuard(newSignIds), data: { inStorage: false } })
      if (newRiderIds.size)
        await tx.customerRider.updateMany({ where: lockGuard(newRiderIds), data: { inStorage: false } })
      if (newLockboxIds.size)
        await tx.customerLockbox.updateMany({ where: lockGuard(newLockboxIds), data: { inStorage: false } })
      if (newBrochureIds.size)
        await tx.customerBrochureBox.updateMany({ where: lockGuard(newBrochureIds), data: { inStorage: false } })

      // Race-safe: invoice-bundle job (admin/invoices) can stamp invoiceId on
      // a pending order at any moment via updateMany({ invoiceId: null }).
      // updateMany with the same predicate here returns count=0 if the bundler
      // raced us, in which case we throw to roll back the whole transaction
      // (orderItem deletes, inventory swaps) and 409 the caller.
      const updateResult = await tx.order.updateMany({
        // invoiceId must be UNCHANGED since the read: null stays the pre-
        // existing bundler race guard; a non-null id can't change (the bundler
        // only touches invoiceId: null rows), so invoiced edits always match.
        // For invoiced edits the baseline anchor doubles as an optimistic-
        // concurrency token — a concurrent edit moved it, and applying this
        // delta on top would double-count that edit's movement.
        where: {
          id,
          invoiceId: existingOrder.invoiceId,
          ...(wasInvoiced
            ? { postInvoiceBaselineCents: existingOrder.postInvoiceBaselineCents }
            : {}),
        },
        data: {
          postTypeId: newPostTypeId,
          // Only when the post actually moved. postRentalDisabled doubles as
          // the admin's manual opt-out, so recomputing it on a date-only or
          // notes-only edit would silently switch billing back on for an order
          // an admin had deliberately excluded.
          ...(newPostTypeId !== existingOrder.postTypeId
            ? { postRentalDisabled: newPostRentalDisabled }
            : {}),
          // Property
          propertyType: propertyType as never,
          // Use the trimmed-to-undefined variants so a blank field ('' from a
          // stale wizard form state) doesn't overwrite the row with '' —
          // matches the coerce at re-resolve above.
          propertyAddress: streetInput ?? existingOrder.propertyAddress,
          propertyCity: cityInput ?? existingOrder.propertyCity,
          propertyState: stateInput ?? existingOrder.propertyState,
          propertyZip: zipInput ?? existingOrder.propertyZip,
          installationLocation: editData.installation_location ?? existingOrder.installationLocation,
          installationLocationImage: editedLocationImage ?? existingOrder.installationLocationImage,
          propertyNotes: editData.installation_notes ?? existingOrder.propertyNotes,
          isGatedCommunity: editData.is_gated_community ?? existingOrder.isGatedCommunity,
          gateCode: editData.gate_code ?? existingOrder.gateCode,
          hasMarkerPlaced: editData.has_marker_placed ?? existingOrder.hasMarkerPlaced,
          streetNumbersVisible: editData.street_numbers_visible ?? existingOrder.streetNumbersVisible,
          signOrientation: editData.sign_orientation ?? existingOrder.signOrientation,
          signOrientationOther: editData.sign_orientation_other ?? existingOrder.signOrientationOther,
          // Scheduling
          scheduledDate,
          isExpedited: editData.is_expedited ?? existingOrder.isExpedited,
          // OOA snapshot — only when we re-resolved this edit. Undefined
          // fields are omitted by Prisma so the existing locked-at-placement
          // values stay untouched on address-unchanged edits. Written for
          // invoiced orders too: invoices never sum this column (the fee lives
          // inside subtotal via its OrderItem), and every later recompute
          // treats it as ground truth for what surcharge the items carry — a
          // stale frozen value would resurrect a removed fee on the next
          // date-only edit.
          ...(resolvedSurchargeCents !== null
            ? {
                serviceAreaSurchargeCents: resolvedSurchargeCents,
                ...(resolvedSecondChargeCents !== undefined
                  ? {
                      serviceAreaSecondChargeCents: resolvedSecondChargeCents,
                      serviceAreaSecondChargeStatus: resolvedSecondChargeStatus,
                    }
                  : {}),
                serviceAreaCenterId: resolvedCenterId,
                serviceAreaDriveMinutes: resolvedDriveMinutes,
                serviceAreaDriveMiles: resolvedDriveMiles,
                serviceAreaDriveTimeSource: resolvedDriveTimeSource,
              }
            : {}),
          // Pricing — FROZEN for invoiced orders (see wasInvoiced above): the
          // sent invoice sums these columns live, so they must keep the values
          // it billed. This edit's price movement lands on the adjustment
          // instead, INCREMENTED so concurrent sweeps and retries stay honest.
          ...(wasInvoiced
            ? {
                // Always advance the anchor (even on a zero delta) so the next
                // edit measures against THIS recompute, not a reconstruction.
                postInvoiceBaselineCents: newPostInvoiceBaselineCents,
                ...(postInvoiceAdjustmentDeltaCents !== 0
                  ? { postInvoiceAdjustmentCents: { increment: postInvoiceAdjustmentDeltaCents } }
                  : {}),
              }
            : {
                subtotal: newSubtotal,
                noPostSurcharge,
                expediteFee,
                discount,
                tax,
                total,
              }),
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
      // Two ways to get here: the bundler stamped invoiceId mid-edit (the
      // pre-existing race), or a concurrent edit of an already-invoiced order
      // moved the baseline anchor. Either way the caller's view is stale.
      return NextResponse.json(
        {
          error: wasInvoiced
            ? 'This order was changed by someone else while you were editing. Refresh to see the latest version and try again.'
            : 'This order was just added to an invoice while you were editing. Refresh to see the latest version.',
          code: 'concurrent_edit',
        },
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

    if (wasInvoiced) {
      // Already on an invoice: money columns were frozen in the tx, so the
      // generic diff below is always 0. The real movement is this edit's
      // recompute-vs-recompute delta (what the tx just incremented onto the
      // pending adjustment) — report THAT so the email and toast say
      // "the $X difference will appear on your next invoice".
      if (postInvoiceAdjustmentDeltaCents !== 0) {
        chargeOutcome = { kind: 'invoice_billing_skip', diff: postInvoiceAdjustmentDeltaCents / 100 }
        newEditChargeStatus = 'invoice_billing_skip'
      }
    } else if (diff !== 0) {
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
          installationLocationImage: fullOrder.installationLocationImage,
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

      // Customer email send conditions:
      //   1. Admin edited another user's order — "by support" copy to owner
      //   2. ANY edit that moved the customer's wallet (card charged, credit
      //      owed, charge failed, no PM) — owner needs a receipt.
      //      Without this, a customer self-edit charges their card with zero
      //      confirmation email — a chargeback magnet.
      // For invoice-billing skips (no Stripe call) and no_change (no $ delta),
      // self-edits don't get a separate email.
      //
      // Recipient routing — three roles to keep straight:
      //   - actor: the logged-in user who clicked Save (= `user`)
      //   - owner: the order's `userId` (= fullOrder.user)
      //   - payer: who got charged (resolveEffectivePayer; = team_admin for
      //     on-behalf-of orders, else == owner)
      //
      // The OWNER always gets the receipt (their order; they're the contact
      // accountants will reach out to). If the PAYER is a different person
      // (team_admin-on-behalf-of pattern: broker pays for the agent's order),
      // they also get a notification — but with editorName copy that makes
      // clear THEY didn't do the edit. Pre-2026-06-29 the broker got the
      // existing "you updated this order" receipt while the agent who
      // actually edited got nothing.
      const isAdminEditingOther = user.role === 'admin' && fullOrder.userId !== user.id
      const isWalletImpact =
        chargeOutcome.kind === 'charged_diff' ||
        chargeOutcome.kind === 'credit_pending' ||
        chargeOutcome.kind === 'charge_failed' ||
        chargeOutcome.kind === 'no_payment_method'

      if (isAdminEditingOther || isWalletImpact) {
        // Fall through to email when fullName/name are blank — Pink Posts has
        // SSO/imported users where email is the only populated identifier.
        // Without this fallback, the broker secondary email's editorName
        // becomes '' which the email function reads as falsy and silently
        // degrades to the generic "Order Confirmation" copy (defeating the
        // entire purpose of Fix 2 for those edge-case agents).
        const ownerName = fullOrder.user.fullName || fullOrder.user.name || fullOrder.user.email
        const ownerEmail = fullOrder.user.email
        const propertyAddressLine = `${fullOrder.propertyAddress}, ${fullOrder.propertyCity}, ${fullOrder.propertyState} ${fullOrder.propertyZip}`
        const itemsForEmail = fullOrder.orderItems.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          total_price: Number(it.totalPrice),
        }))

        try {
          // PRIMARY: receipt to the order owner. "by support" copy if admin
          // edited on their behalf, otherwise neutral "you updated this".
          await sendOrderConfirmationEmail({
            customerName: ownerName,
            customerEmail: ownerEmail,
            orderNumber: fullOrder.orderNumber,
            propertyAddress: propertyAddressLine,
            total: Number(fullOrder.total),
            items: itemsForEmail,
            requestedDate: fullOrder.scheduledDate?.toISOString(),
            installationNotes: fullOrder.propertyNotes || undefined,
            recipientUserId: fullOrder.userId,
            isInvoiceBilling: fullOrder.paymentStatus === 'pending_invoice',
            isEditedBySupport: isAdminEditingOther,
            isSelfEdited: !isAdminEditingOther,
            originalTotal,
            editChargeOutcome: chargeOutcome,
          })
        } catch (ownerEmailErr) {
          console.error('Owner edit receipt email failed:', ownerEmailErr)
        }

        // SECONDARY: notify the payer if they're not the owner. Broker-pays-
        // for-agent-order pattern. editorName copy explains who actually did
        // the edit so the broker doesn't read it as their own action.
        if (payer && payer.id !== fullOrder.userId) {
          const editorName = isAdminEditingOther ? 'Pink Posts support' : ownerName
          try {
            await sendOrderConfirmationEmail({
              customerName: payer.fullName || '',
              customerEmail: payer.email,
              orderNumber: fullOrder.orderNumber,
              propertyAddress: propertyAddressLine,
              total: Number(fullOrder.total),
              items: itemsForEmail,
              requestedDate: fullOrder.scheduledDate?.toISOString(),
              installationNotes: fullOrder.propertyNotes || undefined,
              recipientUserId: payer.id,
              isInvoiceBilling: fullOrder.paymentStatus === 'pending_invoice',
              editorName,
              originalTotal,
              editChargeOutcome: chargeOutcome,
            })
          } catch (payerEmailErr) {
            console.error('Payer edit notification email failed:', payerEmailErr)
          }
        }
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
