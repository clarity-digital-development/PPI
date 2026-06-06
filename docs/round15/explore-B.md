I have enough to report.

---

**Explorer B — Cron + Stripe Charging Pattern Map**

### 1. Cron auth pattern
`app/api/cron/inventory-hold-sweeper/route.ts:4-14` — `GET` handler, bearer-token via `CRON_SECRET`:
```ts
const secret = process.env.CRON_SECRET
if (!secret) return 503 'cron not configured'  // unset/empty short-circuits
const authHeader = request.headers.get('authorization')
if (authHeader !== `Bearer ${secret}`) return 401
```
No IP allowlist. The empty-string vs unset behavior is explicitly tested in `docs/inventory-holds/verify-privacy.md:53-89` (C7) — mirror it. **Recommendation:** copy this block verbatim into `app/api/cron/post-rental-billing/route.ts`.

### 2. Cron triggering in production
**Nothing wires a schedule.** No `railway.json`, `vercel.json`, `nixpacks.toml`, or any `*.yml`/`*.yaml` cron config exists in repo (Glob results all empty). The inventory sweeper endpoint is dormant unless an external caller hits it. `docs/inventory-holds/adv-race.md:73` says "fires every 60s" but that's aspirational, not configured.

**Recommendation:** simplest path = external scheduler (Railway "Cron Service" plugin, GitHub Actions on a schedule, or cron-job.org) POST/GET against the endpoint with `Authorization: Bearer $CRON_SECRET` once daily ~3am ET. Document the schedule in the route's file header so future devs aren't hunting.

### 3. `chargePaymentMethod` signature + behavior
`lib/stripe.ts:79-98`:
```ts
chargePaymentMethod(customerId, paymentMethodId, amount /*cents*/, description, metadata?)
  -> Promise<Stripe.PaymentIntent>
```
Internally: `paymentIntents.create({ off_session: true, confirm: true, ... })`. **No idempotency key passed** — unlike `createPaymentIntent` in `lib/stripe/server.ts:91-143` which accepts `opts.idempotencyKey`. For our cron we MUST pass one (deterministic from `orderId:periodStart`) to survive retries; will need to extend the helper or call `stripe.paymentIntents.create` directly.

3DS-required behavior — `app/api/admin/service-requests/[id]/invoice/route.ts:79-89`: if `paymentIntent.status !== 'succeeded'` after the call (e.g. `requires_action`), the route treats it as failed, stamps `invoiceStatus = 'failed'`, and surfaces "card needs authentication." `getStripeErrorMessage()` at `lib/stripe/server.ts:9-63` parses thrown `StripeCardError` decline codes (insufficient_funds, expired_card, etc.) into friendly strings. **Cron should follow the same pattern: succeeded OR record failure.**

### 4. Receipt email pattern
No generic charge-receipt template exists. `lib/email.ts` exports `sendOrderConfirmationEmail`, `sendRefundConfirmationEmail` (797-849), `sendServiceRequestConfirmationEmail`, `sendInstallationCompleteEmail` — each is bespoke pink-themed HTML gated by `shouldSendEmail(userId, prefKey, recipientPrefs)`. The service-request invoice route at `route.ts:102-112` does NOT send an email — it uses `createNotification` (in-app only). That's a gap to close for post-rental.

**Recommendation:** add `sendPostRentalChargeReceipt({recipientName, recipientEmail, orderNumber, propertyAddress, amount, periodStart, periodEnd, chargedAt, recipientUserId})` to `lib/email.ts` mirroring `sendRefundConfirmationEmail` (797-849) — same pink header, same `shouldSendEmail` gate (bucket under `emailOrderConfirmations`), same `escapeHtml` discipline. Admin-failure email can reuse `sendAdminOrderNotification` or a new `sendAdminPostRentalChargeFailed` — recommend the latter for clearer subject/body.

### 5. AuditAction enum
`lib/audit.ts:69-101` defines a frozen const object. Existing charge-related: `OrderRefundCreate`, `OrderRefundFail`, `OrderRefundWebhook`, `CartCheckoutBegin/Succeed/Fail`. **None for forward charges.**

Add to `lib/audit.ts:100` (before closing `}`):
```ts
PostRentalChargeScheduled: 'post_rental.charge.scheduled',  // attempt initiated
PostRentalChargeSucceeded: 'post_rental.charge.succeeded',
PostRentalChargeFailed:    'post_rental.charge.failed',
PostRentalChargeSkipped:   'post_rental.charge.skipped',    // no card / exempt / pickup-scheduled
PostRentalOverrideToggle:  'post_rental.override.toggle',   // admin per-order opt-in
```

### 6. Idempotency: unique constraint vs reserve-before-Stripe
`lib/refunds.ts:75-110` uses **conditional `updateMany` reserve** because refund flips columns on the same `Order` row — there's nothing to insert. The dance is required there because the lock and the state both live on `Order`.

**Post-rental is the opposite shape**: each charge attempt is a NEW `PostRentalCharge` row, not a column flip. A Prisma `@@unique([orderId, periodStart])` constraint serves the same purpose more cleanly:
- Cron does `prisma.postRentalCharge.create({ data: { orderId, periodStart, status: 'pending' }})` FIRST
- If a concurrent run already inserted for that (orderId, periodStart), the `create` throws `P2002` → catch, skip, done
- Then call Stripe with `idempotencyKey = sha256(`${orderId}:${periodStart.toISOString()}:post_rental_v1`)` — belt-and-suspenders so even if our DB insert+Stripe call were split across two processes that both got past the unique check (impossible, but cheap), Stripe also dedupes

**Confirmed: DB unique constraint is the right primitive here**, not the reserve-then-update pattern. The Stripe-side `idempotencyKey` (mirroring `refundPaymentIntent` at `lib/stripe/server.ts:175-202`) is the second layer.

---

**Files referenced:**
- `c:\Users\tanne\PPI\app\api\cron\inventory-hold-sweeper\route.ts:4-32`
- `c:\Users\tanne\PPI\lib\stripe.ts:79-98`
- `c:\Users\tanne\PPI\lib\stripe\server.ts:9-63, 91-143, 175-202`
- `c:\Users\tanne\PPI\app\api\admin\service-requests\[id]\invoice\route.ts:70-126`
- `c:\Users\tanne\PPI\lib\refunds.ts:75-110, 186-231`
- `c:\Users\tanne\PPI\lib\audit.ts:65-102`
- `c:\Users\tanne\PPI\lib\email.ts:797-849`
- `c:\Users\tanne\PPI\docs\inventory-holds\verify-privacy.md:53-89`