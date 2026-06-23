import { Resend } from 'resend'
import { shouldSendEmail, logSuppressed, type UserEmailPrefs } from '@/lib/email-preferences'

// Result of the diff charge attempted when admin saves an order edit. Drives
// the one-liner shown in the customer + admin emails so accountants can
// reconcile without opening Stripe. Keep in sync with the EditChargeOutcome
// type in app/api/orders/[id]/edit/route.ts AND the EditChargeStatus Prisma
// enum.
export type EditChargeOutcome =
  | { kind: 'no_change' }
  | { kind: 'invoice_billing_skip'; diff: number }
  | { kind: 'charged_diff'; diff: number; paymentIntentId: string; cardLast4: string | null; cardBrand: string | null; netDiff: number; appliedCreditCents: number }
  | { kind: 'charge_failed'; diff: number; reason: string }
  | { kind: 'no_payment_method'; diff: number }
  | { kind: 'credit_pending'; diff: number; pendingCreditCentsAfter: number }

// Builds the inner HTML for the "Change summary" block. Returns '' for
// no_change or missing originalTotal. Palette is semantically meaningful:
//   green: money successfully moved (charged or covered by prior credit)
//   blue:  informational invoice-fold OR refund coming back to you
//   amber: action required by Pink Posts (no card on file, manual collection)
//   red:   card was tried and declined
function renderEditChargeBlock(outcome: EditChargeOutcome | undefined, originalTotal: number | undefined, newTotal: number): string {
  if (!outcome || outcome.kind === 'no_change' || originalTotal === undefined) return ''
  const diff = 'diff' in outcome ? outcome.diff : 0
  const absDiff = Math.abs(diff)
  const diffSign = diff > 0 ? '+' : '-'
  const diffLabel = `${diffSign}$${absDiff.toFixed(2)}`
  let actionLine: string
  let accent: { bg: string; border: string; text: string }
  switch (outcome.kind) {
    case 'charged_diff': {
      // Two sub-cases: full Stripe charge, or fully-credit-offset (no PI created).
      const card = outcome.cardBrand && outcome.cardLast4
        ? ` to ${outcome.cardBrand.toUpperCase()} •••• ${outcome.cardLast4}`
        : ' to your card on file'
      const credit = outcome.appliedCreditCents > 0
        ? ` ($${(outcome.appliedCreditCents / 100).toFixed(2)} applied from your previous credit)`
        : ''
      if (outcome.paymentIntentId === 'credit_offset') {
        actionLine = `<strong>$${absDiff.toFixed(2)} fully covered by your previous credit.</strong> Nothing new was charged.`
      } else {
        actionLine = `<strong>$${outcome.netDiff.toFixed(2)} charged${card}.</strong>${credit}`
      }
      accent = { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46' }
      break
    }
    case 'charge_failed':
      actionLine = `<strong>Card charge for $${absDiff.toFixed(2)} declined.</strong> Pink Posts will reach out at 859-395-8188 to collect — please reply if you'd like to update your card on file.`
      accent = { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' }
      break
    case 'no_payment_method':
      actionLine = `<strong>$${absDiff.toFixed(2)} owed.</strong> We don't have a working card on file — please reply or call 859-395-8188 with payment details.`
      accent = { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E' }
      break
    case 'credit_pending':
      // Refund-coming = blue (informational, good news) — NOT amber, which we
      // reserve for "Pink Posts needs to act" / "customer owes money".
      actionLine = `<strong>Refund of $${absDiff.toFixed(2)} coming your way.</strong> We'll process it to your card on file within 3-5 business days. Reply or call 859-395-8188 if you don't see it.`
      accent = { bg: '#EFF6FF', border: '#BFDBFE', text: '#1E3A8A' }
      break
    case 'invoice_billing_skip':
      actionLine = diff > 0
        ? `<strong>$${absDiff.toFixed(2)} added to your next invoice.</strong>`
        : `<strong>$${absDiff.toFixed(2)} credited on your next invoice.</strong>`
      accent = { bg: '#EFF6FF', border: '#BFDBFE', text: '#1E3A8A' }
      break
  }
  return `
    <div style="background-color: ${accent.bg}; border: 1px solid ${accent.border}; color: ${accent.text}; padding: 14px 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
      <p style="margin: 0 0 8px; font-size: 15px;"><strong>Change summary</strong></p>
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="padding: 2px 0;">Previous total</td><td style="text-align: right; padding: 2px 0;">$${originalTotal.toFixed(2)}</td></tr>
        <tr><td style="padding: 2px 0;">New total</td><td style="text-align: right; padding: 2px 0;">$${newTotal.toFixed(2)}</td></tr>
        <tr><td style="padding: 2px 0; border-top: 1px solid ${accent.border};"><strong>Difference</strong></td><td style="text-align: right; padding: 2px 0; border-top: 1px solid ${accent.border};"><strong>${diffLabel}</strong></td></tr>
      </table>
      <p style="margin: 10px 0 0;">${actionLine}</p>
    </div>
  `
}

// Lazy initialization to avoid build-time errors
let resend: Resend | null = null

function getResend(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured')
    }
    resend = new Resend(process.env.RESEND_API_KEY)
  }
  return resend
}

interface OrderConfirmationEmailProps {
  customerName: string
  customerEmail: string
  orderNumber: string
  propertyAddress: string
  total: number
  items: Array<{ description: string; quantity: number; total_price: number }>
  requestedDate?: string
  // Free-text special instructions captured at checkout ("leave at side door",
  // "agent will meet you at the property", etc.). Rendered prominently so the
  // install crew sees it without digging into the dashboard.
  installationNotes?: string
  // Recipient userId — used to check emailOrderConfirmations pref before send.
  recipientUserId?: string | null
  // Optional inline user prefs to skip a DB roundtrip when caller already has them.
  recipientPrefs?: UserEmailPrefs | null
  // True when this customer pays by invoice (no charge at checkout). Swaps the
  // "thanks for your order" copy for an "added to invoice — bill coming" copy.
  isInvoiceBilling?: boolean
  // True when this email is being sent because Pink Posts admin edited the
  // order on the customer's behalf. Subject becomes "Order updated by
  // support" and a blue banner explains the change. Used by the admin
  // edit flow so brokers know their order was touched.
  isEditedBySupport?: boolean
  // True when the customer self-edited their own order AND the edit moved
  // money (charged the card, owed a refund, etc.). Subject becomes "Order
  // edit receipt" and the banner uses neutral "you updated this order"
  // wording instead of "by support". Mutually exclusive with isEditedBySupport.
  isSelfEdited?: boolean
  // Original (pre-edit) total — drives the change-summary block on edit
  // emails so accountants can reconcile the diff vs. the new total above.
  originalTotal?: number
  // Outcome of the diff charge attempted at edit time — controls the action
  // line on the change-summary block ("$5 charged to Visa ••••1234",
  // "$10 credit pending", "added to your next invoice", etc.).
  editChargeOutcome?: EditChargeOutcome
}

export async function sendOrderConfirmationEmail({
  customerName,
  customerEmail,
  orderNumber,
  propertyAddress,
  total,
  items,
  requestedDate,
  installationNotes,
  recipientUserId,
  recipientPrefs,
  isInvoiceBilling,
  isEditedBySupport,
  isSelfEdited,
  originalTotal,
  editChargeOutcome,
}: OrderConfirmationEmailProps) {
  // Pref gate — opt-out short-circuits before any Resend call.
  if (!(await shouldSendEmail(recipientUserId, 'emailOrderConfirmations', recipientPrefs))) {
    logSuppressed('sendOrderConfirmationEmail', recipientUserId, 'emailOrderConfirmations')
    return { suppressed: true as const }
  }
  const itemsHtml = items
    .map(
      (item) =>
        `<tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.description}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${item.total_price.toFixed(2)}</td>
        </tr>`
    )
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Order Confirmation - Pink Posts Installations</title>
    </head>
    <body style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #FFF0F3;">
      <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #E84A7A; margin: 0;">Pink Posts Installations</h1>
          <p style="color: #666; margin: 8px 0 0;">${isEditedBySupport ? 'Order Updated by Support' : isSelfEdited ? 'Order Edit Receipt' : 'Order Confirmation'}</p>
        </div>

        ${isEditedBySupport ? `
        <div style="background-color: #DBEAFE; border: 1px solid #93C5FD; color: #1E3A8A; padding: 14px 16px; border-radius: 8px; margin-bottom: 24px; font-size: 14px;">
          <strong>Order updated by Pink Posts support.</strong> A member of our team made an adjustment to this order on your behalf. The latest details are below — please use this snapshot instead of the original order confirmation.
        </div>
        ${renderEditChargeBlock(editChargeOutcome, originalTotal, total)}
        ` : isSelfEdited ? `
        <div style="background-color: #DBEAFE; border: 1px solid #93C5FD; color: #1E3A8A; padding: 14px 16px; border-radius: 8px; margin-bottom: 24px; font-size: 14px;">
          <strong>You updated this order.</strong> This is your receipt — the latest details are below. Please use this snapshot instead of the original order confirmation.
        </div>
        ${renderEditChargeBlock(editChargeOutcome, originalTotal, total)}
        ` : ''}

        <p style="color: #333;">Hi ${customerName},</p>
        <p style="color: #333;">${
          isEditedBySupport
            ? `We just updated order ${orderNumber} on your behalf. Here's the current state:`
            : isSelfEdited
              ? `Your edits to order ${orderNumber} are saved. Here's the current state:`
              : (isInvoiceBilling
                  ? `This order has been added to your account and will appear on your next invoice. No payment has been collected yet.`
                  : `Thank you for your order! We've received your request and will begin processing it shortly.`)
        }</p>

        <div style="background-color: #FFF0F3; border-radius: 8px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0; color: #666;"><strong>Order Number:</strong> ${orderNumber}</p>
          <p style="margin: 8px 0 0; color: #666;"><strong>Property:</strong> ${propertyAddress}</p>
          ${requestedDate ? `<p style="margin: 8px 0 0; color: #666;"><strong>Requested Date:</strong> ${requestedDate}</p>` : ''}
          ${isInvoiceBilling ? `<p style="margin: 8px 0 0; color: #B45309;"><strong>Billing:</strong> Pay on invoice</p>` : ''}
        </div>

        ${installationNotes ? `
        <div style="background-color: #FFFBEB; border-left: 4px solid #F59E0B; border-radius: 4px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0 0 8px; color: #92400E; font-weight: bold;">Special Instructions</p>
          <p style="margin: 0; color: #333; white-space: pre-wrap;">${escapeHtml(installationNotes)}</p>
        </div>
        ` : ''}

        <h3 style="color: #333; border-bottom: 2px solid #E84A7A; padding-bottom: 8px;">Order Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: #FFF0F3;">
              <th style="padding: 12px 8px; text-align: left; color: #333;">Item</th>
              <th style="padding: 12px 8px; text-align: center; color: #333;">Qty</th>
              <th style="padding: 12px 8px; text-align: right; color: #333;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding: 12px 8px; text-align: right; font-weight: bold; color: #333;">Total:</td>
              <td style="padding: 12px 8px; text-align: right; font-weight: bold; color: #E84A7A; font-size: 18px;">$${total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee; text-align: center;">
          <p style="color: #666; margin: 0; font-size: 14px;">Questions? Contact us at support@pinkposts.com</p>
          <p style="color: #999; margin: 8px 0 0; font-size: 12px;">&copy; ${new Date().getFullYear()} Pink Posts Installations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `

  return getResend().emails.send({
    from: 'Pink Posts Installations <orders@pinkposts.com>',
    to: customerEmail,
    subject: isEditedBySupport
      ? `Order Updated by Support - ${orderNumber}`
      : isSelfEdited
        ? `Order Edit Receipt - ${orderNumber}`
        : isInvoiceBilling
          ? `Order Added to Invoice - ${orderNumber}`
          : `Order Confirmation - ${orderNumber}`,
    html,
  })
}

interface AdminNotificationEmailProps {
  orderNumber: string
  customerName: string
  customerEmail: string
  customerPhone: string
  propertyAddress: string
  total: number
  items: Array<{ description: string; quantity: number; total_price: number }>
  requestedDate?: string
  isExpedited: boolean
  // Additional details
  propertyType?: string
  postType?: string
  installationNotes?: string
  installationLocation?: string
  isGatedCommunity?: boolean
  gateCode?: string
  hasMarkerPlaced?: boolean
  signOrientation?: string
  signOrientationOther?: string
  subtotal?: number
  discount?: number
  promoCode?: string
  fuelSurcharge?: number
  noPostSurcharge?: number
  expediteFee?: number
  tax?: number
  // Free-text agent name the team_admin tagged at checkout, plus phone from the
  // matching TeamMember row when available. Lets ops know which agent to call
  // about the order without digging into the dashboard.
  assignedAgentName?: string | null
  assignedAgentPhone?: string | null
  // True when this order was placed by an invoice-billing customer (no charge
  // collected at checkout). Surfaces a banner in the admin email so Ryan
  // doesn't expect a payment record.
  isInvoiceBilling?: boolean
  // True when this notification is being re-sent because the order was
  // edited after its original placement. Adds "[EDITED]" to the subject and
  // a banner so admin knows to use this snapshot instead of the earlier
  // email (without it, install crews work from stale data — items, notes,
  // post type can all change post-placement via /api/orders/[id]/edit).
  isEdited?: boolean
  // For isEdited=true: pre-edit total and what happened to the diff (charge,
  // credit-pending, invoice-folded, failed). Drives the "Change summary"
  // block so admin can reconcile vs Stripe without opening the dashboard.
  originalTotal?: number
  editChargeOutcome?: EditChargeOutcome
}

export async function sendAdminOrderNotification({
  orderNumber,
  customerName,
  customerEmail,
  customerPhone,
  propertyAddress,
  total,
  items,
  requestedDate,
  isExpedited,
  propertyType,
  postType,
  installationNotes,
  installationLocation,
  isGatedCommunity,
  gateCode,
  hasMarkerPlaced,
  signOrientation,
  signOrientationOther,
  subtotal,
  discount,
  promoCode,
  fuelSurcharge,
  noPostSurcharge,
  expediteFee,
  tax,
  assignedAgentName,
  assignedAgentPhone,
  isInvoiceBilling,
  isEdited,
  originalTotal,
  editChargeOutcome,
}: AdminNotificationEmailProps) {
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) {
    console.error('ADMIN_EMAIL not configured - skipping admin notification')
    return null
  }

  console.log(`Sending admin notification to ${adminEmail} for order ${orderNumber}`)

  const itemsList = items
    .map((item) => `• ${item.description} (x${item.quantity}) - $${item.total_price.toFixed(2)}`)
    .join('\n')

  // Build pricing breakdown
  let pricingBreakdown = ''
  if (subtotal !== undefined) {
    pricingBreakdown += `\nSubtotal: $${subtotal.toFixed(2)}`
  }
  if (discount && discount > 0) {
    pricingBreakdown += `\nDiscount${promoCode ? ` (${promoCode})` : ''}: -$${discount.toFixed(2)}`
  }
  if (fuelSurcharge !== undefined) {
    pricingBreakdown += `\nFuel Surcharge: $${fuelSurcharge.toFixed(2)}${fuelSurcharge === 0 ? ' (waived)' : ''}`
  }
  if (noPostSurcharge && noPostSurcharge > 0) {
    pricingBreakdown += `\nService Trip Fee (no post): $${noPostSurcharge.toFixed(2)}`
  }
  if (expediteFee && expediteFee > 0) {
    pricingBreakdown += `\nExpedite Fee: $${expediteFee.toFixed(2)}`
  }
  if (tax !== undefined) {
    pricingBreakdown += `\nTax: $${tax.toFixed(2)}`
  }

  // Build installation details section
  let installationDetails = ''
  if (propertyType) {
    installationDetails += `\nProperty Type: ${propertyType.replace('_', ' ')}`
  }
  if (postType) {
    installationDetails += `\nPost Type: ${postType}`
  } else {
    installationDetails += `\nPost Type: None (service trip only)`
  }
  if (installationLocation) {
    installationDetails += `\nInstallation Location: ${installationLocation}`
  }
  if (signOrientation) {
    installationDetails += `\nSign Orientation: ${signOrientation}${signOrientationOther ? ` - ${signOrientationOther}` : ''}`
  }
  if (isGatedCommunity) {
    installationDetails += `\nGated Community: Yes${gateCode ? ` (Code: ${gateCode})` : ''}`
  }
  if (hasMarkerPlaced) {
    installationDetails += `\nMarker Placed: Yes`
  }
  if (installationNotes) {
    installationDetails += `\n\nSpecial Requests / Notes:\n${installationNotes}`
  }

  const assignedAgentLine = assignedAgentName
    ? `\nAssigned Agent: ${assignedAgentName}${assignedAgentPhone ? ` (${assignedAgentPhone})` : ''}`
    : ''

  // Plain-text change summary for edited orders — mirrors the customer-side
  // block but is text-only for the admin notification. Skipped when there's
  // no diff to report.
  let editChangeSummary = ''
  if (isEdited && editChargeOutcome && editChargeOutcome.kind !== 'no_change' && originalTotal !== undefined) {
    const diff = 'diff' in editChargeOutcome ? editChargeOutcome.diff : 0
    const absDiff = Math.abs(diff)
    const sign = diff > 0 ? '+' : '-'
    let action = ''
    switch (editChargeOutcome.kind) {
      case 'charged_diff': {
        const card = editChargeOutcome.cardBrand && editChargeOutcome.cardLast4
          ? `${editChargeOutcome.cardBrand.toUpperCase()} ****${editChargeOutcome.cardLast4}`
          : 'card on file'
        const creditNote = editChargeOutcome.appliedCreditCents > 0
          ? ` (applied $${(editChargeOutcome.appliedCreditCents / 100).toFixed(2)} from prior credit)`
          : ''
        if (editChargeOutcome.paymentIntentId === 'credit_offset') {
          action = `✅ FULLY COVERED by prior credit — no Stripe charge needed${creditNote}.`
        } else {
          action = `✅ CHARGED $${editChargeOutcome.netDiff.toFixed(2)} to ${card} (PaymentIntent: ${editChargeOutcome.paymentIntentId})${creditNote}.`
        }
        break
      }
      case 'charge_failed':
        action = `❌ CHARGE FAILED for $${absDiff.toFixed(2)} — ${editChargeOutcome.reason}. COLLECT MANUALLY. See /admin/orders worklist filter "Charge issues".`
        break
      case 'no_payment_method':
        action = `⚠️ $${absDiff.toFixed(2)} OWED — no usable card on file. COLLECT MANUALLY.`
        break
      case 'credit_pending':
        action = `⚠️ $${absDiff.toFixed(2)} CREDIT PENDING — issue refund via Stripe dashboard. Total unresolved credit on this order: $${(editChargeOutcome.pendingCreditCentsAfter / 100).toFixed(2)}.`
        break
      case 'invoice_billing_skip':
        action = diff > 0
          ? `$${absDiff.toFixed(2)} will be added to next invoice (order is pending_invoice).`
          : `$${absDiff.toFixed(2)} will be credited on next invoice (order is pending_invoice).`
        break
    }
    editChangeSummary = `
================================================================
                       CHANGE SUMMARY
================================================================
  Previous total: $${originalTotal.toFixed(2)}
  New total:      $${total.toFixed(2)}
  Difference:     ${sign}$${absDiff.toFixed(2)}

  ACTION: ${action}
================================================================
`
  }

  const text = `
${isEdited ? '✏️ ORDER EDITED — use this snapshot, NOT the original email. Items, notes, or post type may have changed since placement.\n\n' : ''}${isEdited ? 'Updated Order Details' : 'New Order Received!'}

Order Number: ${orderNumber}
${isExpedited ? '⚡ EXPEDITED ORDER' : ''}${isInvoiceBilling ? '\n📄 INVOICE BILLING — no payment collected at checkout. Bundle from /admin/invoices.' : ''}

Customer Information:
- Name: ${customerName}
- Email: ${customerEmail}
- Phone: ${customerPhone}${assignedAgentLine}

Property: ${propertyAddress}
${requestedDate ? `Requested Date: ${requestedDate}` : 'Requested Date: Next Available'}

Installation Details:${installationDetails}

Order Items:
${itemsList}
${editChangeSummary}
Pricing Breakdown:${pricingBreakdown}
Total: $${total.toFixed(2)}

View order details in the admin dashboard.
  `.trim()

  try {
    const result = await getResend().emails.send({
      from: 'Pink Posts Installations <orders@pinkposts.com>',
      to: adminEmail,
      // Edited orders get a clear "[EDITED]" prefix so admin can spot the
      // re-send in their inbox vs the original placement email.
      subject: `${isEdited ? '✏️ [EDITED] ' : ''}${isExpedited ? '⚡ EXPEDITED ' : ''}${isInvoiceBilling ? '📄 INVOICE ' : ''}${isEdited ? 'Updated Order' : 'New Order'}: ${orderNumber}`,
      text,
    })
    console.log(`Admin notification sent successfully for order ${orderNumber}:`, result)
    return result
  } catch (error) {
    console.error(`Failed to send admin notification for order ${orderNumber}:`, error)
    throw error
  }
}

interface InvoiceEmailProps {
  invoiceId: string
  invoiceNumber: string
  customerName: string
  customerEmail: string
  companyName?: string | null
  rangeStart: string // yyyy-mm-dd
  rangeEnd: string // yyyy-mm-dd
  total: number
  orderCount: number
  // Bundled service-trip count alongside orders. Optional so older call sites
  // continue to compile; defaults to 0 in the body copy when absent.
  serviceRequestCount?: number
  // Optional rendered PDF (from buildInvoicePdfBytes). When present, attached
  // to the email so the customer has the document in their inbox for records.
  pdfBytes?: Uint8Array | null
  // Public URL that opens the invoice PDF inline in the browser (token-gated
  // via /api/invoices/[id]/pdf?token=…). Primary "view" link in the email.
  pdfUrl?: string | null
  // Stripe-hosted Checkout Session URL. Primary "pay" link in the email —
  // customer pays on Stripe without visiting pinkposts.com.
  payUrl?: string | null
  // Override the From and Subject — used by the example-email path to make
  // it visually distinct from a real customer invoice.
  fromOverride?: string
  subjectOverride?: string
  // Optional yellow banner above the greeting, used by the example flow to
  // make it obvious this is a preview and the customer wasn't really billed.
  bannerHtml?: string
  recipientUserId?: string | null
  recipientPrefs?: UserEmailPrefs | null
}

/**
 * Sent when an admin bundles a date range of pending_invoice orders (and
 * service trips) into an Invoice. Customer clicks "Pay invoice" → lands on
 * /dashboard/invoices/[id] which renders the Stripe Payment Element.
 *
 * When `pdfBytes` is supplied, the rendered PDF is attached so the customer
 * has the document in their inbox alongside the Pay link.
 */
export async function sendInvoiceEmail({
  invoiceId: _invoiceId,
  invoiceNumber,
  customerName,
  customerEmail,
  companyName,
  rangeStart,
  rangeEnd,
  total,
  orderCount,
  serviceRequestCount = 0,
  pdfBytes,
  pdfUrl,
  payUrl,
  fromOverride,
  subjectOverride,
  bannerHtml,
}: InvoiceEmailProps) {
  // CR3 (Round 22): an invoice is a transactional billing document and must
  // ALWAYS send, even when the recipient has opted out of order/marketing
  // email. CAN-SPAM exempts transactional/relationship mail, and password-reset
  // + admin-alert emails in this file already bypass preferences the same way.
  // There is therefore deliberately NO shouldSendEmail() gate here.
  // (recipientUserId / recipientPrefs stay on InvoiceEmailProps for call-site
  // symmetry with the other senders, but are intentionally not consulted.)

  // Build the bundle-count line — "N orders + M service trips" when both,
  // collapses cleanly when only one kind is present.
  const countLineParts: string[] = []
  if (orderCount > 0) countLineParts.push(`${orderCount} order${orderCount === 1 ? '' : 's'}`)
  if (serviceRequestCount > 0) countLineParts.push(`${serviceRequestCount} service trip${serviceRequestCount === 1 ? '' : 's'}`)
  const countLine = countLineParts.join(' + ') || 'this invoice'

  // The two CTAs the email body offers. Both point AWAY from pinkposts.com
  // proper — pdfUrl lands on a token-gated PDF route that the browser
  // renders inline, payUrl is a Stripe-hosted Checkout Session.
  const viewPdfButton = pdfUrl
    ? `
        <div style="text-align: center; margin: 32px 0 16px;">
          <a href="${pdfUrl}" style="background-color: #ffffff; color: #E84A7A; border: 2px solid #E84A7A; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 15px;">View Invoice (PDF)</a>
        </div>
    `
    : ''
  const payButton = payUrl
    ? `
        <div style="text-align: center; margin: 8px 0 32px;">
          <a href="${payUrl}" style="background-color: #E84A7A; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 16px;">Pay $${total.toFixed(2)} via Stripe</a>
          <p style="color: #999; font-size: 12px; margin: 8px 0 0;">Secure payment processed by Stripe — no account required.</p>
        </div>
    `
    : ''

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invoice ${invoiceNumber} - Pink Posts Installations</title>
    </head>
    <body style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #FFF0F3;">
      <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        ${bannerHtml ?? ''}
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #E84A7A; margin: 0;">Pink Posts Installations</h1>
          <p style="color: #666; margin: 8px 0 0;">Invoice ${invoiceNumber}</p>
        </div>

        <p style="color: #333;">Hi ${customerName},</p>
        <p style="color: #333;">Your invoice for activity between <strong>${rangeStart}</strong> and <strong>${rangeEnd}</strong> is ready.</p>

        <div style="background-color: #FFF0F3; border-radius: 8px; padding: 20px; margin: 24px 0;">
          ${companyName ? `<p style="margin: 0 0 8px; color: #666;"><strong>${escapeHtml(companyName)}</strong></p>` : ''}
          <p style="margin: 0; color: #666;"><strong>${countLine}</strong> bundled on this invoice</p>
          <p style="margin: 16px 0 0; font-size: 28px; font-weight: bold; color: #E84A7A;">$${total.toFixed(2)}</p>
        </div>

        ${viewPdfButton}
        ${payButton}

        ${pdfBytes ? `<p style="color: #666; font-size: 13px; text-align: center;">A PDF copy is also attached to this email for your records.</p>` : ''}
        <p style="color: #666; font-size: 13px; text-align: center;">All bundled items will be marked paid once the Stripe payment clears.</p>

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee; text-align: center;">
          <p style="color: #666; margin: 0; font-size: 14px;">Questions? Contact us at support@pinkposts.com</p>
          <p style="color: #999; margin: 8px 0 0; font-size: 12px;">&copy; ${new Date().getFullYear()} Pink Posts Installations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `

  // Resend's attachments expect base64 string OR a Node Buffer — Buffer is
  // available server-side in Next.js API routes and the example-email path.
  const attachments = pdfBytes
    ? [{ filename: `invoice-${invoiceNumber}.pdf`, content: Buffer.from(pdfBytes) }]
    : undefined

  return getResend().emails.send({
    from: fromOverride ?? 'Pink Posts Installations <orders@pinkposts.com>',
    to: customerEmail,
    subject: subjectOverride ?? `Invoice ${invoiceNumber} — $${total.toFixed(2)}`,
    html,
    ...(attachments ? { attachments } : {}),
  })
}

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://pinkposts.com'
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Reset Your Password - Pink Posts Installations</title>
    </head>
    <body style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #FFF0F3;">
      <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #E84A7A; margin: 0;">Pink Posts Installations</h1>
          <p style="color: #666; margin: 8px 0 0;">Password Reset Request</p>
        </div>

        <p style="color: #333;">Hi,</p>
        <p style="color: #333;">We received a request to reset your password. Click the button below to create a new password:</p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="background-color: #E84A7A; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Reset Password</a>
        </div>

        <p style="color: #666; font-size: 14px;">This link will expire in 1 hour for security reasons.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee; text-align: center;">
          <p style="color: #999; margin: 0; font-size: 12px;">&copy; ${new Date().getFullYear()} Pink Posts Installations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `

  return getResend().emails.send({
    from: 'Pink Posts Installations <noreply@pinkposts.com>',
    to: email,
    subject: 'Reset Your Password - Pink Posts Installations',
    html,
  })
}

// Lockboxes already on-site at an installation — surfaced in SR emails so the
// install crew knows what's there before they roll a truck. Serial is optional
// because InstallationLockbox has no FK back to CustomerLockbox yet (gap).
export interface ExistingLockboxSummary {
  type: string
  serialNumber?: string | null
  code?: string | null
}

// Shared formatter so all 4 SR templates render the same line shape.
function formatExistingLockboxLine(lb: ExistingLockboxSummary): string {
  const parts: string[] = []
  if (lb.serialNumber) parts.push(`Serial: ${lb.serialNumber}`)
  if (lb.code) parts.push(`Code: ${lb.code}`)
  const suffix = parts.length ? ` — ${parts.join('  ')}` : ' — (no code on file)'
  return `${lb.type}${suffix}`
}

// HTML-escaped variant of the above for the 3 HTML templates.
function formatExistingLockboxLineHtml(lb: ExistingLockboxSummary): string {
  const parts: string[] = []
  if (lb.serialNumber) parts.push(`Serial: ${escapeHtml(lb.serialNumber)}`)
  if (lb.code) parts.push(`Code: ${escapeHtml(lb.code)}`)
  const suffix = parts.length ? ` — ${parts.join('  ')}` : ' — (no code on file)'
  return `${escapeHtml(lb.type)}${suffix}`
}

// Pink-tinted info block rendered in HTML templates when existingLockboxes
// is non-empty. Distinct from the yellow special-instructions block so the
// install crew can tell them apart at a glance.
function renderExistingLockboxesHtml(lockboxes: ExistingLockboxSummary[] | undefined): string {
  if (!lockboxes || lockboxes.length === 0) return ''
  const itemsHtml = lockboxes
    .map(lb => `<li style="margin: 4px 0; color: #333;">${formatExistingLockboxLineHtml(lb)}</li>`)
    .join('')
  return `
    <div style="background-color: #FFE4EC; border-left: 4px solid #E84A7A; border-radius: 4px; padding: 16px; margin: 24px 0;">
      <p style="margin: 0 0 8px; color: #9B1C47; font-weight: bold;">Existing lockboxes at this property</p>
      <ul style="margin: 0; padding-left: 20px;">${itemsHtml}</ul>
    </div>
  `
}

interface AdminServiceRequestNotificationProps {
  customerName: string
  customerEmail?: string
  customerPhone?: string
  requestType: string
  description?: string
  requestedDate?: string
  notes?: string
  installationAddress: string
  installedItems?: string // For removal requests: what was originally installed at the address
  // On-site lockboxes — rendered when SR is tied to an existing installation.
  existingLockboxes?: ExistingLockboxSummary[]
}

export async function sendAdminServiceRequestNotification({
  customerName,
  customerEmail,
  customerPhone,
  requestType,
  description,
  requestedDate,
  notes,
  installationAddress,
  installedItems,
  existingLockboxes,
}: AdminServiceRequestNotificationProps) {
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) {
    console.error('ADMIN_EMAIL not configured - skipping admin service request notification')
    return null
  }

  // Plain-text block — one lockbox per line, mirrors the HTML block exactly.
  const lockboxBlock = existingLockboxes && existingLockboxes.length > 0
    ? `Existing lockboxes at this property:\n${existingLockboxes.map(lb => `  - ${formatExistingLockboxLine(lb)}`).join('\n')}`
    : null

  const lines = [
    'New Service Request Received!',
    '',
    `Customer: ${customerName}`,
    customerEmail ? `Email: ${customerEmail}` : null,
    customerPhone ? `Phone: ${customerPhone}` : null,
    `Request Type: ${requestType}`,
    `Address: ${installationAddress}`,
    requestedDate ? `Requested Date: ${requestedDate}` : null,
    '',
    description ? `Description:\n${description}\n` : null,
    notes ? `Special Instructions:\n${notes}\n` : null,
    installedItems ? `What was installed here (please bring back):\n${installedItems}` : null,
    lockboxBlock,
  ].filter(Boolean)

  return getResend().emails.send({
    from: 'Pink Posts Installations <orders@pinkposts.com>',
    to: adminEmail,
    subject: `New Service Request: ${requestType} - ${installationAddress}`,
    text: lines.join('\n'),
  })
}

interface ServiceRequestConfirmationEmailProps {
  customerName: string
  customerEmail: string
  requestId: string
  requestType: string
  description?: string
  notes?: string
  requestedDate?: string
  propertyAddress: string
  // On-site lockboxes — rendered when SR is tied to an existing installation.
  existingLockboxes?: ExistingLockboxSummary[]
  // Recipient userId — used to check emailServiceRequests pref before send.
  recipientUserId?: string | null
  // Optional inline prefs to skip a DB roundtrip when caller already has them.
  recipientPrefs?: UserEmailPrefs | null
}

// Friendly label for request type — matches customer-facing copy elsewhere.
function labelRequestType(type: string): string {
  switch (type) {
    case 'service':
      return 'Service Trip'
    case 'removal':
      return 'Removal'
    case 'repair':
      return 'Repair'
    case 'replacement':
      return 'Replacement'
    default:
      return type.charAt(0).toUpperCase() + type.slice(1)
  }
}

/**
 * Customer-facing confirmation that a service request was received. Mirrors
 * sendOrderConfirmationEmail in look + feel so customers get the same pink-
 * branded reassurance for SRs that they already get for orders.
 */
export async function sendServiceRequestConfirmationEmail({
  customerName,
  customerEmail,
  requestId,
  requestType,
  description,
  notes,
  requestedDate,
  propertyAddress,
  existingLockboxes,
  recipientUserId,
  recipientPrefs,
}: ServiceRequestConfirmationEmailProps) {
  // Pref gate — opt-out short-circuits before any Resend call.
  if (!(await shouldSendEmail(recipientUserId, 'emailServiceRequests', recipientPrefs))) {
    logSuppressed('sendServiceRequestConfirmationEmail', recipientUserId, 'emailServiceRequests')
    return { suppressed: true as const }
  }
  const friendlyType = labelRequestType(requestType)

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Service Request Received - Pink Posts Installations</title>
    </head>
    <body style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #FFF0F3;">
      <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #E84A7A; margin: 0;">Pink Posts Installations</h1>
          <p style="color: #666; margin: 8px 0 0;">Service Request Received</p>
        </div>

        <p style="color: #333;">Hi ${escapeHtml(customerName)},</p>
        <p style="color: #333;">Thank you for your request. Our team has been notified and will be in touch shortly.</p>

        <div style="background-color: #FFF0F3; border-radius: 8px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0; color: #666;"><strong>Request ID:</strong> ${escapeHtml(requestId)}</p>
          <p style="margin: 8px 0 0; color: #666;"><strong>Type:</strong> ${escapeHtml(friendlyType)}</p>
          <p style="margin: 8px 0 0; color: #666;"><strong>Property:</strong> ${escapeHtml(propertyAddress)}</p>
          ${requestedDate ? `<p style="margin: 8px 0 0; color: #666;"><strong>Requested Date:</strong> ${escapeHtml(requestedDate)}</p>` : ''}
        </div>

        ${description ? `
        <h3 style="color: #333; border-bottom: 2px solid #E84A7A; padding-bottom: 8px;">Description</h3>
        <p style="color: #333; white-space: pre-wrap;">${escapeHtml(description)}</p>
        ` : ''}

        ${renderExistingLockboxesHtml(existingLockboxes)}

        ${notes ? `
        <div style="background-color: #FFFBEB; border-left: 4px solid #F59E0B; border-radius: 4px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0 0 8px; color: #92400E; font-weight: bold;">Special Instructions</p>
          <p style="margin: 0; color: #333; white-space: pre-wrap;">${escapeHtml(notes)}</p>
        </div>
        ` : ''}

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee; text-align: center;">
          <p style="color: #666; margin: 0; font-size: 14px;">Questions? <a href="mailto:support@pinkposts.com" style="color: #E84A7A;">support@pinkposts.com</a> or 859-395-8188</p>
          <p style="color: #999; margin: 8px 0 0; font-size: 12px;">&copy; ${new Date().getFullYear()} Pink Posts Installations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `

  return getResend().emails.send({
    from: 'Pink Posts Installations <orders@pinkposts.com>',
    to: customerEmail,
    subject: `Service Request Received - ${requestId}`,
    html,
  })
}

/**
 * Notify the customer when a service request (especially a removal) is marked
 * complete. Removals are the case the client specifically called out — but the
 * same email works for service, repair, replacement too.
 */
export async function sendServiceRequestCompletedEmail({
  customerEmail,
  customerName,
  requestType,
  address,
  existingLockboxes,
  recipientUserId,
  recipientPrefs,
}: {
  customerEmail: string
  customerName: string
  requestType: string
  address: string
  // On-site lockboxes — rendered when SR is tied to an existing installation.
  existingLockboxes?: ExistingLockboxSummary[]
  // Recipient userId — used to check emailServiceRequests pref before send.
  recipientUserId?: string | null
  // Optional inline prefs to skip a DB roundtrip when caller already has them.
  recipientPrefs?: UserEmailPrefs | null
}) {
  // Pref gate — opt-out short-circuits before any Resend call.
  if (!(await shouldSendEmail(recipientUserId, 'emailServiceRequests', recipientPrefs))) {
    logSuppressed('sendServiceRequestCompletedEmail', recipientUserId, 'emailServiceRequests')
    return { suppressed: true as const }
  }
  const friendlyType = requestType === 'removal' ? 'Removal' : requestType.charAt(0).toUpperCase() + requestType.slice(1)
  // Plain-text trailer mirrors the HTML block — kept short, only when present.
  const lockboxTrailer = existingLockboxes && existingLockboxes.length > 0
    ? `\n\nExisting lockboxes at this property:\n${existingLockboxes.map(lb => `  - ${formatExistingLockboxLine(lb)}`).join('\n')}`
    : ''
  const text = `Hi ${customerName},\n\nGreat news — your ${friendlyType.toLowerCase()} at ${address} has been completed.${lockboxTrailer}\n\nIf you have any questions or need another service, just reply to this email or visit your dashboard.\n\nThanks,\nPink Posts Installations`

  try {
    const result = await getResend().emails.send({
      from: 'Pink Posts Installations <orders@pinkposts.com>',
      to: customerEmail,
      subject: `${friendlyType} complete: ${address}`,
      text,
    })
    return result
  } catch (error) {
    console.error('Failed to send service-request-complete email:', error)
    throw error
  }
}

/**
 * Notify the customer when admin transitions a service request to a non-
 * completed status (acknowledged / scheduled / in_progress / cancelled).
 * Completed transitions stay on sendServiceRequestCompletedEmail so its
 * existing copy + subject line don't change.
 */
export async function sendServiceRequestStatusEmail({
  customerName,
  customerEmail,
  requestId,
  requestType,
  newStatus,
  scheduledDate,
  propertyAddress,
  notes,
  existingLockboxes,
  recipientUserId,
  recipientPrefs,
}: {
  customerName: string
  customerEmail: string
  requestId: string
  requestType: string
  newStatus: 'acknowledged' | 'scheduled' | 'in_progress' | 'cancelled'
  scheduledDate?: Date | null
  propertyAddress?: string
  notes?: string | null
  // On-site lockboxes — rendered when SR is tied to an existing installation.
  existingLockboxes?: ExistingLockboxSummary[]
  // Recipient userId — used to check emailServiceRequests pref before send.
  recipientUserId?: string | null
  // Optional inline prefs to skip a DB roundtrip when caller already has them.
  recipientPrefs?: UserEmailPrefs | null
}) {
  // Pref gate — opt-out short-circuits before any Resend call.
  if (!(await shouldSendEmail(recipientUserId, 'emailServiceRequests', recipientPrefs))) {
    logSuppressed('sendServiceRequestStatusEmail', recipientUserId, 'emailServiceRequests')
    return { suppressed: true as const }
  }
  const friendlyType = requestType === 'removal' ? 'Removal' : requestType.charAt(0).toUpperCase() + requestType.slice(1)
  const statusLabels: Record<typeof newStatus, string> = {
    acknowledged: 'Acknowledged',
    scheduled: 'Scheduled',
    in_progress: 'In Progress',
    cancelled: 'Cancelled',
  }
  const statusLabel = statusLabels[newStatus]
  const formattedDate = scheduledDate
    ? scheduledDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : null

  // Status-specific body copy — kept short, mirrors the in-app notification.
  let bodyCopy = ''
  switch (newStatus) {
    case 'acknowledged':
      bodyCopy = "Your service request has been received and is being reviewed. We'll be in touch with next steps shortly."
      break
    case 'scheduled':
      bodyCopy = formattedDate
        ? `Your ${friendlyType.toLowerCase()} request has been scheduled for <strong>${escapeHtml(formattedDate)}</strong>. Our crew will see you then.`
        : `Your ${friendlyType.toLowerCase()} request has been scheduled. Our crew will be in touch with the date shortly.`
      break
    case 'in_progress':
      bodyCopy = `Our crew is on the way / working on your ${friendlyType.toLowerCase()} request now.`
      break
    case 'cancelled':
      bodyCopy = 'Your service request has been cancelled. If this is unexpected, please contact us.'
      break
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Service Request ${escapeHtml(statusLabel)} - Pink Posts Installations</title>
    </head>
    <body style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #FFF0F3;">
      <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #E84A7A; margin: 0;">Pink Posts Installations</h1>
          <p style="color: #666; margin: 8px 0 0;">Service Request ${escapeHtml(statusLabel)}</p>
        </div>

        <p style="color: #333;">Hi ${escapeHtml(customerName)},</p>
        <p style="color: #333;">${bodyCopy}</p>

        <div style="background-color: #FFF0F3; border-radius: 8px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0; color: #666;"><strong>Request ID:</strong> ${escapeHtml(requestId)}</p>
          <p style="margin: 8px 0 0; color: #666;"><strong>Type:</strong> ${escapeHtml(friendlyType)}</p>
          <p style="margin: 8px 0 0; color: #666;"><strong>Status:</strong> ${escapeHtml(statusLabel)}</p>
          ${propertyAddress ? `<p style="margin: 8px 0 0; color: #666;"><strong>Address:</strong> ${escapeHtml(propertyAddress)}</p>` : ''}
          ${newStatus === 'scheduled' && formattedDate ? `<p style="margin: 8px 0 0; color: #666;"><strong>Scheduled For:</strong> ${escapeHtml(formattedDate)}</p>` : ''}
        </div>

        ${renderExistingLockboxesHtml(existingLockboxes)}

        ${notes ? `
        <div style="background-color: #FFFBEB; border-left: 4px solid #F59E0B; border-radius: 4px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0 0 8px; color: #92400E; font-weight: bold;">Notes from our team</p>
          <p style="margin: 0; color: #333; white-space: pre-wrap;">${escapeHtml(notes)}</p>
        </div>
        ` : ''}

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee; text-align: center;">
          <p style="color: #666; margin: 0; font-size: 14px;">Questions? Contact us at support@pinkposts.com</p>
          <p style="color: #999; margin: 8px 0 0; font-size: 12px;">&copy; ${new Date().getFullYear()} Pink Posts Installations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `

  try {
    const result = await getResend().emails.send({
      from: 'Pink Posts Installations <orders@pinkposts.com>',
      to: customerEmail,
      subject: `Service Request ${statusLabel} - ${requestId}`,
      html,
    })
    return result
  } catch (error) {
    console.error('Failed to send service-request-status email:', error)
    throw error
  }
}

export async function sendInstallationCompleteEmail(
  customerEmail: string,
  customerName: string,
  propertyAddress: string,
  // Recipient userId — used to check emailOrderConfirmations pref before send.
  recipientUserId?: string | null,
  // Optional inline prefs to skip a DB roundtrip when caller already has them.
  recipientPrefs?: UserEmailPrefs | null,
) {
  // Pref gate — opt-out short-circuits before any Resend call.
  if (!(await shouldSendEmail(recipientUserId, 'emailOrderConfirmations', recipientPrefs))) {
    logSuppressed('sendInstallationCompleteEmail', recipientUserId, 'emailOrderConfirmations')
    return { suppressed: true as const }
  }
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Installation Complete - Pink Posts Installations</title>
    </head>
    <body style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #FFF0F3;">
      <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #E84A7A; margin: 0;">Pink Posts Installations</h1>
          <p style="color: #666; margin: 8px 0 0;">Installation Complete!</p>
        </div>

        <p style="color: #333;">Hi ${customerName},</p>
        <p style="color: #333;">Great news! Your sign installation at <strong>${propertyAddress}</strong> has been completed.</p>

        <p style="color: #333;">You can view your active installations and manage your orders from your dashboard.</p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="background-color: #E84A7A; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Dashboard</a>
        </div>

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee; text-align: center;">
          <p style="color: #666; margin: 0; font-size: 14px;">Thank you for choosing Pink Posts Installations!</p>
        </div>
      </div>
    </body>
    </html>
  `

  return getResend().emails.send({
    from: 'Pink Posts Installations <orders@pinkposts.com>',
    to: customerEmail,
    subject: 'Your Sign Installation is Complete!',
    html,
  })
}

export interface RefundConfirmationEmailProps {
  recipientName: string
  recipientEmail: string
  orderNumber: string
  propertyAddress: string
  refundAmount: number
  refundReason?: string
  refundedAt: Date
  refundedBy: 'customer' | 'admin'
  /** True if processed automatically (under-threshold) — surfaces in body copy. */
  auto: boolean
  /** Recipient userId — used to check emailOrderConfirmations pref before send. */
  recipientUserId?: string | null
  /** Optional inline prefs to skip a DB roundtrip when caller already has them. */
  recipientPrefs?: UserEmailPrefs | null
}

export async function sendRefundConfirmationEmail(props: RefundConfirmationEmailProps) {
  // Pref gate — refunds are bucketed under emailOrderConfirmations since
  // they're the receipt for an order being undone. Opt-out short-circuits.
  if (!(await shouldSendEmail(props.recipientUserId, 'emailOrderConfirmations', props.recipientPrefs))) {
    logSuppressed('sendRefundConfirmationEmail', props.recipientUserId, 'emailOrderConfirmations')
    return { suppressed: true as const }
  }
  const formattedDate = props.refundedAt.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const headerCopy = props.refundedBy === 'customer'
    ? 'Your order has been cancelled and a refund has been initiated.'
    : 'Your order has been cancelled by our team and a refund has been initiated.'
  const processingCopy = props.auto
    ? 'This refund was processed automatically. Funds typically appear on your statement in 5-10 business days.'
    : 'This refund was approved by our team. Funds typically appear on your statement in 5-10 business days.'

  // All user/order-supplied strings are HTML-escaped — recipientName comes
  // from User.fullName (user-supplied at signup), orderNumber and
  // propertyAddress are server-controlled but escaping is defense in depth.
  const html = `
    <div style="background:#FFF0F3;padding:32px 16px;font-family:'Poppins',Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.06);overflow:hidden">
        <div style="background:#E84A7A;padding:24px;text-align:center">
          <h1 style="margin:0;color:white;font-size:24px">Refund Confirmation</h1>
        </div>
        <div style="padding:32px 24px;color:#333;line-height:1.6">
          <p>Hi ${escapeHtml(props.recipientName)},</p>
          <p>${headerCopy}</p>
          <div style="background:#FFF0F3;padding:16px;border-radius:8px;margin:24px 0">
            <p style="margin:0 0 8px"><strong>Order:</strong> ${escapeHtml(props.orderNumber)}</p>
            <p style="margin:0 0 8px"><strong>Property:</strong> ${escapeHtml(props.propertyAddress)}</p>
            <p style="margin:0 0 8px"><strong>Refund Amount:</strong> $${props.refundAmount.toFixed(2)}</p>
            <p style="margin:0"><strong>Cancelled On:</strong> ${escapeHtml(formattedDate)}</p>
            ${props.refundReason ? `<p style="margin:8px 0 0"><strong>Reason:</strong> ${escapeHtml(props.refundReason)}</p>` : ''}
          </div>
          <p style="color:#666;font-size:14px">${processingCopy}</p>
          <p>Questions? Contact us at <a href="mailto:support@pinkposts.com" style="color:#E84A7A">support@pinkposts.com</a> or 859-395-8188.</p>
        </div>
        <div style="padding:16px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee">
          Pink Posts Installations
        </div>
      </div>
    </div>
  `

  return getResend().emails.send({
    from: 'Pink Posts Installations <orders@pinkposts.com>',
    to: props.recipientEmail,
    subject: `Refund Confirmation - ${props.orderNumber}`,
    html,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─────────────────────── Post-rental billing emails ───────────────────────

export interface PostRentalChargeReceiptProps {
  recipientUserId: string
  recipientName: string
  recipientEmail: string
  orderNumber: string
  propertyAddress: string
  amountCents: number
  chargeType: 'six_month' | 'nine_month' | 'monthly'
  periodStart: Date
  periodEnd: Date
  chargedAt: Date
  // Optional last4 of the card charged — surfaces in the body if provided.
  cardLast4?: string | null
  // Optional inline prefs to skip a DB roundtrip when caller has them.
  recipientPrefs?: UserEmailPrefs | null
}

function chargeTypeLabel(t: 'six_month' | 'nine_month' | 'monthly'): string {
  if (t === 'six_month') return '6-month anchor (covers months 7-9)'
  if (t === 'nine_month') return '9-month anchor (covers months 10-12)'
  return 'monthly post rental'
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

/**
 * Receipt sent to the customer after a successful post-rental charge.
 * Gated by emailOrderConfirmations — same bucket as the order receipt.
 */
export async function sendPostRentalChargeReceipt(
  props: PostRentalChargeReceiptProps
) {
  if (!(await shouldSendEmail(props.recipientUserId, 'emailOrderConfirmations', props.recipientPrefs))) {
    logSuppressed('sendPostRentalChargeReceipt', props.recipientUserId, 'emailOrderConfirmations')
    return { suppressed: true as const }
  }

  const amount = (props.amountCents / 100).toFixed(2)
  const periodStartStr = formatDateLong(props.periodStart)
  const periodEndStr = formatDateLong(props.periodEnd)
  const chargedAtStr = formatDateLong(props.chargedAt)
  const typeLabel = chargeTypeLabel(props.chargeType)

  const html = `
    <div style="background:#FFF0F3;padding:32px 16px;font-family:'Poppins',Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.06);overflow:hidden">
        <div style="background:#E84A7A;padding:24px;text-align:center">
          <h1 style="margin:0;color:white;font-size:24px">Post Rental Charge</h1>
        </div>
        <div style="padding:32px 24px;color:#333;line-height:1.6">
          <p>Hi ${escapeHtml(props.recipientName)},</p>
          <p>We just processed a scheduled post rental charge on the card you have on file. This is part of the standard rental schedule for the post installed at your property.</p>
          <div style="background:#FFF0F3;padding:16px;border-radius:8px;margin:24px 0">
            <p style="margin:0 0 8px"><strong>Order:</strong> ${escapeHtml(props.orderNumber)}</p>
            <p style="margin:0 0 8px"><strong>Property:</strong> ${escapeHtml(props.propertyAddress)}</p>
            <p style="margin:0 0 8px"><strong>Amount:</strong> $${amount}</p>
            <p style="margin:0 0 8px"><strong>Covers:</strong> ${escapeHtml(periodStartStr)} – ${escapeHtml(periodEndStr)}</p>
            <p style="margin:0 0 8px"><strong>Charge type:</strong> ${escapeHtml(typeLabel)}</p>
            ${props.cardLast4 ? `<p style="margin:0 0 8px"><strong>Card:</strong> ending in ${escapeHtml(props.cardLast4)}</p>` : ''}
            <p style="margin:0"><strong>Charged on:</strong> ${escapeHtml(chargedAtStr)}</p>
          </div>
          <p style="color:#666;font-size:14px">Your initial installation included the first 6 months of post rent. After that, we charge $18 every 3 months for months 7-12, then $6/month thereafter — until pickup is scheduled. Pickup ends the rental clock automatically.</p>
          <p>Questions? Contact us at <a href="mailto:support@pinkposts.com" style="color:#E84A7A">support@pinkposts.com</a> or 859-395-8188.</p>
        </div>
        <div style="padding:16px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee">
          Pink Posts Installations
        </div>
      </div>
    </div>
  `

  return getResend().emails.send({
    from: 'Pink Posts Installations <orders@pinkposts.com>',
    to: props.recipientEmail,
    subject: `Post rental charge — Order ${props.orderNumber}`,
    html,
  })
}

export interface AdminChargeFailureAlertProps {
  orderNumber: string
  orderId: string
  customerEmail: string
  amountCents: number
  failureCode: string
  failureMessage: string
  attemptCount: number
  // True when attemptCount >= 7 — surfaces an escalation prefix in the subject.
  escalate: boolean
}

/**
 * Admin alert when a post-rental charge fails. Caller decides whether to
 * send (we skip silent-card-missing in the cron); the helper itself always
 * sends when invoked. Plain text format to ADMIN_EMAIL.
 */
export async function sendAdminChargeFailureAlert(
  props: AdminChargeFailureAlertProps
) {
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) {
    console.error('ADMIN_EMAIL not configured - skipping post-rental failure alert')
    return null
  }

  const amount = (props.amountCents / 100).toFixed(2)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pinkpostinstallations.com'
  const link = `${appUrl}/admin/orders/${props.orderId}`
  const subjectPrefix = props.escalate ? '[ESCALATION 7+ days] ' : ''

  const text = `${subjectPrefix}Post rental charge failed.

Order: ${props.orderNumber}
Customer: ${props.customerEmail}
Amount: $${amount}
Attempt count: ${props.attemptCount}

Failure code: ${props.failureCode}
Failure message: ${props.failureMessage}

View order: ${link}

This alert was generated by the post-rental billing cron. The charge has been recorded as failed in the order's rental history and is visible in the admin Rental card. Click "Retry" on the failed row to re-queue it on the next cron pass.`

  try {
    return await getResend().emails.send({
      from: 'Pink Posts Installations <orders@pinkposts.com>',
      to: adminEmail,
      subject: `${subjectPrefix}[PPI] Post rental charge failed — ${props.orderNumber}`,
      text,
    })
  } catch (err) {
    console.error('Failed to send post-rental admin alert:', err)
    return null
  }
}
