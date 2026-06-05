import { Resend } from 'resend'
import { shouldSendEmail, logSuppressed, type UserEmailPrefs } from '@/lib/email-preferences'

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
          <p style="color: #666; margin: 8px 0 0;">Order Confirmation</p>
        </div>

        <p style="color: #333;">Hi ${customerName},</p>
        <p style="color: #333;">Thank you for your order! We've received your request and will begin processing it shortly.</p>

        <div style="background-color: #FFF0F3; border-radius: 8px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0; color: #666;"><strong>Order Number:</strong> ${orderNumber}</p>
          <p style="margin: 8px 0 0; color: #666;"><strong>Property:</strong> ${propertyAddress}</p>
          ${requestedDate ? `<p style="margin: 8px 0 0; color: #666;"><strong>Requested Date:</strong> ${requestedDate}</p>` : ''}
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
    subject: `Order Confirmation - ${orderNumber}`,
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

  const text = `
New Order Received!

Order Number: ${orderNumber}
${isExpedited ? '⚡ EXPEDITED ORDER' : ''}

Customer Information:
- Name: ${customerName}
- Email: ${customerEmail}
- Phone: ${customerPhone}

Property: ${propertyAddress}
${requestedDate ? `Requested Date: ${requestedDate}` : 'Requested Date: Next Available'}

Installation Details:${installationDetails}

Order Items:
${itemsList}

Pricing Breakdown:${pricingBreakdown}
Total: $${total.toFixed(2)}

View order details in the admin dashboard.
  `.trim()

  try {
    const result = await getResend().emails.send({
      from: 'Pink Posts Installations <orders@pinkposts.com>',
      to: adminEmail,
      subject: `${isExpedited ? '⚡ EXPEDITED ' : ''}New Order: ${orderNumber}`,
      text,
    })
    console.log(`Admin notification sent successfully for order ${orderNumber}:`, result)
    return result
  } catch (error) {
    console.error(`Failed to send admin notification for order ${orderNumber}:`, error)
    throw error
  }
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
