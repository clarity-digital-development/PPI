import { Resend } from 'resend'

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
}

export async function sendOrderConfirmationEmail({
  customerName,
  customerEmail,
  orderNumber,
  propertyAddress,
  total,
  items,
  requestedDate,
}: OrderConfirmationEmailProps) {
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

export async function sendInstallationCompleteEmail(
  customerEmail: string,
  customerName: string,
  propertyAddress: string
) {
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
