Confirmed schema-driven via `db push`. The new `confirmation_email_sent_at` column will be added on next deploy push.

---

## Summary

### (a) 13007 Laviena / 3323 Dell Road — REAL orders, not test data

Both orders found in the Railway production DB:

| field | order 1 | order 2 |
|---|---|---|
| orderNumber | `PPI-MPYB4102-7DCE` | `PPI-MPYC7V8C-NBST` |
| address | `13007 Lavenia Lane, Louisville` (Ryan typo'd "Laviena") | `3323 Dell Road, Louisville` |
| total | $60.77 | $63.95 |
| paymentStatus | `succeeded` | `succeeded` |
| paymentIntentId | `pi_3TeI3vHYBBlnMslH1LV4IorH` | `pi_3TeIXvHYBBlnMslH07YbuePE` |
| createdAt | 2026-06-03 16:54 UTC | 2026-06-03 17:25 UTC |
| user | `supportstaff@semonin.com` (team_admin, "Admin Team Account") | same |
| placedByUserId | `null` | `null` |
| placedForAgentName | `"Unassigned"` | `"Unassigned"` |
| propertyNotes | "Signs will be in Mary Elsenbroek's office at Semonin — 13906 Promenade Green Way. An admin can help you retrieve them." | "Agent is Julie Davis / 502.435.9830; signs will be at the property" |

Evidence both are REAL: PI ids are live-mode Stripe IDs with account `HYBBlnMslH` (no `pi_test_*` or `pi_smoke_*` prefix), `paidAt === createdAt` (charge captured), real-team owner. Both have meaningful customer special instructions in `propertyNotes` — exactly the "leave at side door" type content Ryan called out as missing from the email.

### (b) Why admin-team orders weren't getting confirmation emails — REAL BUG

`paidAt` being identical to `createdAt` (microsecond-level) means these orders came through **`/api/orders/batch`** (cart checkout), not `/api/orders` (single-order POST). The batch route created orders inside a transaction, then stamped `paidAt` from a single `updateMany` after the PI succeeded.

**Root cause**: `/api/orders/batch/route.ts` had **zero synchronous email sending**. It relied entirely on the `payment_intent.succeeded` Stripe webhook to fire emails. The single-order `/api/orders` route sends emails synchronously the moment the PI succeeds (line ~430-470 in the original) — but the batch route had no equivalent. If the webhook delivery is delayed, dropped, secret-misconfigured, or fails for any transient reason, the customer never receives a confirmation. The admin team account (`supportstaff@semonin.com`) checks out *exclusively* through the cart/batch path because they place multiple orders per session — so this gap hit them every time.

Secondary observation: `placedByUserId = null` and `placedForAgentName = 'Unassigned'`, so the recipient logic (`user.email`) does correctly land on `supportstaff@semonin.com`. The recipient was right; the email simply wasn't sent.

### (c) Notes-in-email + email-send wiring

**Schema** (`prisma/schema.prisma`)
- Added `Order.confirmationEmailSentAt DateTime?` reservation column (mirrors `refundEmailSentAt` pattern). Requires `npm run db:push` on deploy.

**`lib/email.ts`**
- `OrderConfirmationEmailProps` now accepts optional `installationNotes`.
- Customer HTML email renders a yellow-bordered **"Special Instructions"** block (HTML-escaped, `white-space: pre-wrap`) just above the order details table when notes are present.
- `sendAdminOrderNotification` already had `installationNotes` in props and renders it in the text body — no template change needed; only call-site wiring was missing.

**`app/api/orders/batch/route.ts`** (the main fix)
- Imported `sendOrderConfirmationEmail`, `sendAdminOrderNotification`.
- After PI stamping, loops through `createdOrders`, reserves the email slot via conditional `updateMany({ where: { id, confirmationEmailSentAt: null } })`, then sends both emails per order. Passes `full.propertyNotes` → `installationNotes` on both calls. Rolls back the reservation on send failure so the webhook retry can pick it up.

**`app/api/webhooks/stripe/route.ts`**
- Same reservation pattern at the top of the `payment_intent.succeeded` loop — if the synchronous batch/single-order path already sent, this no-ops; otherwise this is the safety net.
- Now passes `order.propertyNotes` → `installationNotes` on both helpers and threads through all the admin-notification details (installationLocation, gate code, sign orientation, full pricing breakdown) which were previously omitted from the webhook path.

**`app/api/orders/route.ts`** (single-order POST)
- Wrapped existing sync send in the reservation check.
- Passes `orderData.installation_notes` → `installationNotes` on the customer email call.

**`app/api/admin/orders/[id]/charge/route.ts`** (admin manual charge)
- Wrapped sync send in the reservation check; passes `order.propertyNotes` → `installationNotes` on both customer + admin emails.

### Typecheck
`npx tsc --noEmit` → clean (no output, exit 0).

### Files modified
- `c:\Users\tanne\PPI\prisma\schema.prisma`
- `c:\Users\tanne\PPI\lib\email.ts`
- `c:\Users\tanne\PPI\app\api\orders\route.ts`
- `c:\Users\tanne\PPI\app\api\orders\batch\route.ts`
- `c:\Users\tanne\PPI\app\api\webhooks\stripe\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\orders\[id]\charge\route.ts`

### Deploy step required
`npm run db:push` to add the `confirmation_email_sent_at` column before the new code paths exercise the conditional update (Prisma will throw on the missing column otherwise). All four email-emitting routes use the same reservation column, so any single migration covers all of them.