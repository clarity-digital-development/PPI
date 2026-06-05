Sufficient. Now I have everything for the report.

---

# Auditor C — Email/SMS Send-Site Catalog

## Twilio / SMS reality check

- `grep -i twilio` across the repo: **zero hits**. No SDK install, no env var read, no client.
- `grep sms` outside `lib/twilio`: only one hit — the `defaultChecked` checkbox in `app/dashboard/profile/page.tsx` (the cosmetic toggle).
- **Conclusion: the "SMS notifications for installation updates" toggle is 100% aspirational.** No SMS is sent today. Recommend either removing the toggle or labelling it "Coming soon" until a Twilio (or other) provider is wired in. Do **not** persist an SMS preference flag yet — there's nothing to gate.

## Email helpers exported from `lib/email.ts`

There are **9** exported send-helpers. (No others — verified by grepping `export async function send` in `lib/`.)

| # | Helper | Surface |
|---|---|---|
| 1 | `sendOrderConfirmationEmail` | customer |
| 2 | `sendAdminOrderNotification` | admin inbox |
| 3 | `sendPasswordResetEmail` | customer |
| 4 | `sendAdminServiceRequestNotification` | admin inbox |
| 5 | `sendServiceRequestConfirmationEmail` | customer |
| 6 | `sendServiceRequestCompletedEmail` | customer |
| 7 | `sendServiceRequestStatusEmail` | customer |
| 8 | `sendInstallationCompleteEmail` | customer |
| 9 | `sendRefundConfirmationEmail` | customer (broker-routed) |

## Full call-site table

| Helper | Call sites | Recipient resolution | Suggested preference flag |
|---|---|---|---|
| `sendOrderConfirmationEmail` | `app/api/orders/route.ts:460` (POST /orders – immediate-pay), `app/api/orders/batch/route.ts:480` (batch orders), `app/api/webhooks/stripe/route.ts:107` (payment_intent.succeeded), `app/api/admin/orders/[id]/charge/route.ts:86` (admin-initiated charge) | `order.user.email` directly — the user who placed the order (for team orders this is the agent, **not** routed via `resolveRefundRecipient`) | `email_order_confirmations` |
| `sendAdminOrderNotification` | `app/api/orders/route.ts:470`, `app/api/orders/batch/route.ts:494`, `app/api/webhooks/stripe/route.ts:121`, `app/api/admin/orders/[id]/charge/route.ts:99` | `process.env.ADMIN_EMAIL` (Ryan's inbox — single static address) | **Not user-preference-gated.** Admin opts out via env var or future internal admin UI. |
| `sendPasswordResetEmail` | `app/api/auth/forgot-password/route.ts:51` | The email submitted to the forgot-password form (normalized) | **Never gated.** Security-critical. |
| `sendAdminServiceRequestNotification` | `app/api/installations/[id]/service-request/route.ts:112`, `app/api/service-requests/route.ts:142` | `process.env.ADMIN_EMAIL` | **Not user-preference-gated** (same admin inbox). |
| `sendServiceRequestConfirmationEmail` | `app/api/installations/[id]/service-request/route.ts:144`, `app/api/service-requests/route.ts:175` | `userInfo.email` — the requester (i.e., the logged-in customer/agent who filed the SR) | `email_service_requests` |
| `sendServiceRequestCompletedEmail` | `app/api/admin/service-requests/[id]/route.ts:214` (status → completed) | Looked up: `prisma.user.findUnique({ where: { id: serviceRequest.userId } }).email` | `email_service_requests` |
| `sendServiceRequestStatusEmail` | `app/api/admin/service-requests/[id]/route.ts:222` (status → acknowledged/scheduled/in_progress/cancelled) | Same lookup as above (`customer.email`) | `email_service_requests` |
| `sendInstallationCompleteEmail` | `app/api/orders/[id]/route.ts:282` (admin marks order completed) | `order.user.email` (placer of the order — same caveat as order confirmations re: team placedByUserId not being honored) | `email_order_confirmations` (it's an order-lifecycle event, not an SR) |
| `sendRefundConfirmationEmail` | `lib/refunds.ts:200` (`processRefund()` — used by customer self-cancel + admin refund), `app/api/webhooks/stripe/route.ts:300` (charge.refunded webhook) | `resolveRefundRecipient(order)` — **brokers (team_admins) routed**, otherwise customer | `email_order_confirmations` (refunds are part of the order lifecycle) |

### Notes the team should know

1. **Recipient-routing inconsistency.** Order confirmations and installation-complete emails go to `order.user.email` (the agent who placed). Refund emails go through `resolveRefundRecipient`, which prefers the broker. If Semonin is complaining about volume, **the agent inbox is the one being flooded** for confirmations — flag-gating per-user is correct, but a broker who toggles off "order confirmations" on **their** account doesn't help their agents. Two options: (a) store the flag on the user who *receives* the email (agent), and let each agent toggle independently; (b) cascade: if `team_admin` toggles off a flag, also default it off for their team's agents. I recommend (a) for the MVP — simpler, and broker-account toggles still work for broker-placed orders. Note this as a known limitation in the changelog.

2. **No backend wiring exists today** — the profile page has 4 `defaultChecked` checkboxes with no `onChange`, no API endpoint, no Prisma column. This is greenfield.

3. **Admin notifications go to a single env-configured inbox**, not per-user. Don't waste a flag on them.

## Recommended preference flag set

Three flags. Three. That's it.

```prisma
model User {
  // ...existing fields
  emailOrderConfirmations    Boolean @default(true)  // orders, refunds, installation-complete
  emailServiceRequests       Boolean @default(true)  // SR confirmation + 4 status transitions + completion
  emailMarketing             Boolean @default(false) // default OFF — explicit opt-in (CAN-SPAM friendly)
}
```

**Rationale:**

- **`emailOrderConfirmations`** silences `sendOrderConfirmationEmail`, `sendInstallationCompleteEmail`, and `sendRefundConfirmationEmail`. These are the per-order events that scale with order volume — the actual Semonin volume problem. Grouping refund into the order bucket is intentional: it's a single order-lifecycle stream, not a distinct concern.
- **`emailServiceRequests`** silences the four SR helpers (confirmation, status, completion, and — implicitly — anything future in that family). SRs are the new noisy round-6 stream; large brokerages will generate many removals.
- **`emailMarketing`** is an explicit opt-in (default false). No code currently sends marketing email, but Ryan promised the toggle and we want to be CAN-SPAM clean before any future blast. Stored, surfaced, gated when/if marketing emails ship.

**Deliberately omitted:**

- SMS — nothing sends SMS. Remove the toggle or label "Coming soon."
- Password reset — security email, never gated.
- Admin notifications — single env-configured inbox, not user-scoped.
- Per-event granularity (separate "scheduled" vs "in_progress" toggles, etc.) — over-engineering for what Semonin actually asked for, which is "less email please."

## Implementation guidance (one paragraph)

Add a tiny `lib/email-preferences.ts` helper: `async function shouldSend(userId, flag): Promise<boolean>` that loads the User row once and returns the flag (default true on null/missing). Each `send*` call site that targets a customer (everything except admin + password reset) wraps in `if (await shouldSend(recipientUserId, 'emailOrderConfirmations')) { ... }`. For refunds, the recipientUserId is whatever `resolveRefundRecipient` returns — extend that helper to also return `id`. Audit-log the suppression as `EMAIL_SUPPRESSED_BY_PREFERENCE` (action) so support can debug "I didn't get my receipt" tickets. `npx tsc --noEmit` before declaring done.