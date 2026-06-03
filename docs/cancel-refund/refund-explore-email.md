TodoWrite isn't applicable here — this is a single read-only mapping task. Here is the email infrastructure map.

---

# Email Infrastructure Map for Refund Email

## 1. Provider + Send Function Signature

**Provider:** Resend (npm `resend`), lazy-initialized via `getResend()` in `c:\Users\tanne\PPI\lib\email.ts:1-14`. Throws if `RESEND_API_KEY` missing.

**Underlying send call shape** (used by every helper):
```ts
getResend().emails.send({
  from: 'Pink Posts Installations <orders@pinkposts.com>', // or noreply@ for non-order
  to: <string>,
  subject: <string>,
  html?: <string>,
  text?: <string>,
})
```

**Helper export pattern:** named `async function send<Thing>Email(props: <Interface>)`, returns the Resend result (or `null` if env missing for admin variants). All helpers live in `lib/email.ts` (no separate templates dir).

## 2. Template Style

**Inline HTML strings inside the helper** (no React-Email, no MJML, no separate template files). Style conventions baked in:
- Wrapper background `#FFF0F3` (light pink), inner card white, 12px radius, soft shadow.
- Header brand color `#E84A7A` ("Pink Posts" pink).
- Font stack `'Poppins', Arial, sans-serif`, max-width 600px.
- Footer pattern: `Questions? Contact us at support@pinkposts.com` + `© ${year} Pink Posts Installations. All rights reserved.`

Customer-facing emails use HTML. Internal/admin emails (`sendAdminOrderNotification`, `sendAdminServiceRequestNotification`) use `text` plain-text only. The short `sendServiceRequestCompletedEmail` also uses `text` — so plain text is acceptable for transactional confirmations.

## 3. Typical Payload Shape

From `OrderConfirmationEmailProps` (lib/email.ts:16-24):
```ts
{ customerName, customerEmail, orderNumber, propertyAddress, total, items, requestedDate? }
```
Address is always pre-formatted at the call site as `"${addr}, ${city}, ${state} ${zip}"` (see `app/api/orders/route.ts:423`). `total` is a `number` (callers do `Number(order.total)` to convert Decimal). Money is formatted in-template via `$${n.toFixed(2)}`.

## 4. Proposed `sendRefundConfirmationEmail` Signature

Matches existing conventions (props object, optional fields with `?`, money as `number`, address pre-formatted by caller, returns Resend result):

```ts
interface RefundConfirmationEmailProps {
  recipientName: string
  recipientEmail: string
  orderNumber: string
  propertyAddress: string          // pre-formatted "addr, city, state zip"
  refundAmount: number             // dollars, formatted in template with toFixed(2)
  refundReason?: string            // free-text customer reason; optional for admin-initiated
  originalCardLast4?: string       // from Stripe charge.payment_method_details if available
  refundedAt: Date                 // formatted in template
  refundedBy: 'customer' | 'admin' // drives copy ("You cancelled..." vs "Our team cancelled...")
  auto: boolean                    // true => "automatically processed"; false => "approved by our team"
}

export async function sendRefundConfirmationEmail(props: RefundConfirmationEmailProps)
```

Recommend HTML (customer-facing) using the same `#FFF0F3` / `#E84A7A` / Poppins / 12px-radius card chrome as `sendOrderConfirmationEmail` and `sendInstallationCompleteEmail`. Subject: `Refund Confirmation - ${orderNumber}`. From: `Pink Posts Installations <orders@pinkposts.com>`.

## 5. Where the Template Lives

**Inside `c:\Users\tanne\PPI\lib\email.ts`** as a new exported function — matches 100% of existing convention. Do NOT create `components/emails/` or `templates/` (neither exists). Add the new `AuditAction` constants for refund lifecycle alongside the audit calls in the caller, not in `lib/email.ts`.

## 6. Error / Retry Behavior

**No retries anywhere.** Two distinct failure patterns exist:

- **Caller-swallow pattern** (preferred for customer transactional emails): `app/api/orders/route.ts:417-459` wraps `Promise.all([send...])` in `try/catch`, logs `Error sending emails for order ${orderNumber}`, never re-throws — order creation succeeds even if email fails.
- **Helper-rethrow pattern**: `sendAdminOrderNotification` (lib/email.ts:246-258) and `sendServiceRequestCompletedEmail` (lib/email.ts:379-390) wrap in try/catch, log, then `throw error`.

**Recommendation for refund email:** follow the helper-rethrow pattern (log + rethrow) and let the cancel route / webhook handler wrap the call in its own try/catch that logs to audit (`AuditAction.OrderRefundFail` already exists per the spec) but does NOT roll back the refund. Money already moved — email failure must be non-fatal and audited.

**Idempotency note:** Resend does not dedupe. The cancel route must guard against double-sending (e.g., webhook fires after explicit refund call) by checking an audit-log marker or an Order column like `refundEmailSentAt` before invoking. The existing webhook→email path in `app/api/webhooks/stripe/route.ts:95-108` has the same gap for confirmation emails (relies on `paymentStatus === 'succeeded'` flip), so mirror that approach.

## Env Vars

Already configured in `.env.example` and `.env.local`:
- `RESEND_API_KEY` (required; lazy-checked)
- `ADMIN_EMAIL=contact@pinkposts.com` (used only for admin-bound notifications; refund email goes to broker/customer, not admin, so this is NOT needed for v1)
- `NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL` (used by `sendPasswordResetEmail` and `sendInstallationCompleteEmail` for dashboard CTA — recommend including a "View Order" link in the refund email using the same pattern)

No new env vars required.