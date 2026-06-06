# Post-Rental Billing — Implementation Spec

## 1. Schema additions

**New model in `prisma/schema.prisma`:**

```prisma
model PostRentalCharge {
  id                    String   @id @default(cuid())
  orderId               String   @map("order_id")
  order                 Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  chargeType            PostRentalChargeType
  amountCents           Int      @map("amount_cents")
  periodStart           DateTime @map("period_start")
  periodEnd             DateTime @map("period_end")
  stripePaymentIntentId String?  @map("stripe_payment_intent_id")
  status                PostRentalChargeStatus @default(scheduled)
  attemptedAt           DateTime? @map("attempted_at")
  succeededAt           DateTime? @map("succeeded_at")
  failureCode           String?  @map("failure_code")
  failureMessage        String?  @map("failure_message")
  attemptCount          Int      @default(0) @map("attempt_count")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@unique([orderId, periodStart], name: "post_rental_charge_order_period_unique")
  @@index([status, periodStart])
  @@index([orderId])
  @@map("post_rental_charges")
}

enum PostRentalChargeType {
  six_month   @map("6mo")
  nine_month  @map("9mo")
  monthly
}

enum PostRentalChargeStatus {
  scheduled
  attempting
  succeeded
  failed
  skipped
}
```

**Order column additions:**

```prisma
postRentalEnabledOverride Boolean   @default(false) @map("post_rental_enabled_override")
postRentalStoppedAt       DateTime? @map("post_rental_stopped_at")
postRentalCharges         PostRentalCharge[]
```

**New `AuditAction` constants in `lib/audit.ts`:**

```ts
PostRentalChargeScheduled: 'post_rental.charge.scheduled',
PostRentalChargeAttempt:   'post_rental.charge.attempt',
PostRentalChargeSucceeded: 'post_rental.charge.succeeded',
PostRentalChargeFailed:    'post_rental.charge.failed',
PostRentalChargeSkipped:   'post_rental.charge.skipped',
PostRentalChargeRetry:     'post_rental.charge.retry',
PostRentalOverrideToggle:  'post_rental.override.toggle',
PostRentalStopped:         'post_rental.stopped',
```

## 2. Eligibility predicate

`lib/post-rental/eligibility.ts`:

```ts
export function isOrderRentalEligible(args: {
  order: Order & { user: User; installation: Installation | null };
  now: Date;
  billingStartAt: Date; // from POST_RENTAL_BILLING_START_AT env
}): { eligible: true } | { eligible: false; reason: string }
```

Rules (short-circuit in order):
1. `installation == null || installation.status !== 'active'` → not eligible (no post in ground OR already pulled).
2. `order.postRentalStoppedAt != null` → not eligible (cron previously observed pickup).
3. `installation.removalDate != null` → set `postRentalStoppedAt`, not eligible. **Suppress entirely** if `removalDate < installedAt + 6 months`.
4. `user.role === 'admin' || user.role === 'team_admin' || user.isServiceAreaExempt` → not eligible (exempt).
5. `installation.installedAt < billingStartAt && !order.postRentalEnabledOverride` → not eligible (grandfathered).
6. `order.status !== 'completed' || order.paymentStatus !== 'succeeded'` → not eligible.
7. Otherwise eligible.

## 3. `chargesDue` function

`lib/post-rental/charges-due.ts`:

```ts
type DueCharge = {
  periodStart: Date;
  periodEnd: Date;
  chargeType: 'six_month' | 'nine_month' | 'monthly';
  amountCents: number;
};

export function chargesDue(installedAt: Date, now: Date): DueCharge[]
```

**Math (use `addMonths` from `date-fns`):**
- T = `installedAt` (midnight UTC of that calendar day).
- 6-month anchor: `addMonths(T, 6)` → `{ periodStart: T+6mo, periodEnd: T+9mo, chargeType: 'six_month', amountCents: 1800 }`.
- 9-month anchor: `addMonths(T, 9)` → `{ periodStart: T+9mo, periodEnd: T+12mo, chargeType: 'nine_month', amountCents: 1800 }`.
- Monthly: for `k = 0, 1, 2, ...` while `addMonths(T, 12 + k) <= now`: `{ periodStart: T+(12+k)mo, periodEnd: T+(13+k)mo, chargeType: 'monthly', amountCents: 600 }`.

Returns ALL due tuples (cron inserts missing rows; the unique constraint dedupes). Pure function — no I/O.

## 4. Cron endpoint

`app/api/cron/post-rental-billing/route.ts` — `GET` handler.

**Auth:** copy `inventory-hold-sweeper` block verbatim (CRON_SECRET bearer, 503 if unset).

**Query params:** `?dry_run=true` returns the would-fire summary without inserting/charging.

**Pass 1 — Scheduling:**
```ts
const orders = await prisma.order.findMany({
  where: { status: 'completed', paymentStatus: 'succeeded',
           installation: { status: 'active' },
           postRentalStoppedAt: null },
  include: { user: true, installation: true },
});
for (const order of orders) {
  const elig = isOrderRentalEligible({ order, now, billingStartAt });
  if (!elig.eligible) continue;
  for (const due of chargesDue(order.installation.installedAt, now)) {
    try {
      await prisma.postRentalCharge.create({
        data: { orderId: order.id, ...due, status: 'scheduled' },
      });
      await audit({ action: AuditAction.PostRentalChargeScheduled, ... });
    } catch (e) { if (!isP2002(e)) throw e; /* dupe; skip */ }
  }
}
```

**Pass 2 — Attempting:**
```ts
const due = await prisma.postRentalCharge.findMany({
  where: { status: 'scheduled', periodStart: { lte: now } },
  include: { order: { include: { user: true, installation: true, placedBy: true } } },
});
for (const row of due) {
  // Atomic reserve — only one concurrent runner wins.
  const reserved = await prisma.postRentalCharge.updateMany({
    where: { id: row.id, status: 'scheduled' },
    data: { status: 'attempting', attemptedAt: new Date(),
            attemptCount: { increment: 1 } },
  });
  if (reserved.count === 0) continue;

  const payer = await resolveBillingPayer(row.order);
  if (!payer.paymentMethodId) {
    await markFailed(row, 'no_payment_method', 'No card on file');
    continue; // quiet — no admin alert
  }

  const idemKey = `post_rental:${row.orderId}:${row.periodStart.toISOString()}:v1`;
  try {
    const pi = await stripe.paymentIntents.create({
      customer: payer.stripeCustomerId,
      payment_method: payer.paymentMethodId,
      amount: row.amountCents, currency: 'usd',
      off_session: true, confirm: true,
      description: `Post rental — Order ${row.order.orderNumber}`,
      metadata: { post_rental_charge_id: row.id, order_id: row.orderId,
                  charge_type: row.chargeType },
    }, { idempotencyKey: idemKey });

    if (pi.status === 'succeeded') {
      await markSucceeded(row, pi.id);
      await sendPostRentalChargeReceipt({ ... });
    } else {
      await markFailed(row, pi.status, 'Charge did not complete');
      await sendAdminChargeFailureAlert({ ... });
    }
  } catch (err) {
    const { code, message } = parseStripeError(err);
    await markFailed(row, code, message);
    if (code !== 'no_payment_method') {
      await sendAdminChargeFailureAlert({
        ..., escalate: row.attemptCount >= 7,
      });
    }
  }
}
```

**Response shape:**
```json
{ "scanned": 139, "eligible": 134, "scheduled": 2,
  "attempted": 2, "succeeded": 2, "failed": 0,
  "skipped": 5, "dryRun": false }
```

## 5. Production schedule

External scheduler (Railway Cron Service plugin) hits the endpoint **daily at 8am ET (13:00 UTC)** with `Authorization: Bearer $CRON_SECRET`. Documented in the route file header.

Operational switches:
- `CRON_SECRET` — required, route 503s without it.
- `POST_RENTAL_BILLING_START_AT` — ISO date string. **Default to `2099-01-01T00:00:00Z`** in `.env.example` so the cron is dormant. Tanner sets a real date to go live.
- `ADMIN_EMAIL` — failure alert recipient.

## 6. Receipts

Add to `lib/email.ts`:

```ts
sendPostRentalChargeReceipt(args: {
  recipientUserId: string;
  recipientName: string;
  recipientEmail: string;
  orderNumber: string;
  propertyAddress: string;
  amountCents: number;
  chargeType: 'six_month' | 'nine_month' | 'monthly';
  periodStart: Date;
  periodEnd: Date;
  chargedAt: Date;
}): Promise<void>
```

- Subject: `Post rental charge — Order ${orderNumber}`
- Pink header matching `sendRefundConfirmationEmail` (797-849).
- Body explains period covered, amount, card last4, and that the charge is part of the standard post rental schedule.
- Gated by `shouldSendEmail(recipientUserId, 'emailOrderConfirmations', recipientPrefs)`.

## 7. Admin failure alert

```ts
sendAdminChargeFailureAlert(args: {
  orderNumber: string;
  orderId: string;
  customerEmail: string;
  amountCents: number;
  failureCode: string;
  failureMessage: string;
  attemptCount: number;
  escalate: boolean; // true when attemptCount >= 7
}): Promise<void>
```

- Recipient: `ADMIN_EMAIL`.
- Subject: `[PPI] Post rental charge failed — ${orderNumber}` (escalation prefix `[ESCALATION 7+ days]` when `escalate`).
- **Skip entirely** when `failureCode === 'no_payment_method'` — caller handles the check; the helper trusts its inputs and always sends.
- Body: failure code, message, link to `/admin/orders/{orderId}`, attempt count.

## 8. Admin visibility on `/admin/orders/[id]`

New `<PostRentalCard>` component fed by `GET /api/admin/orders/[id]/post-rental`:

**Response:**
```ts
{
  status: 'active' | 'grandfathered' | 'stopped' | 'exempt' | 'never_eligible';
  reason?: string;                    // human label
  installedAt: string | null;
  stoppedAt: string | null;
  override: boolean;
  nextCharge: { dueDate: string; chargeType: string; amountCents: number } | null;
  history: Array<{
    id: string; chargeType: string; amountCents: number;
    periodStart: string; periodEnd: string; status: string;
    attemptedAt: string | null; succeededAt: string | null;
    failureCode: string | null; failureMessage: string | null;
    stripePaymentIntentId: string | null;
  }>;
}
```

**UI:**
- Status block (top): color-coded badge + one-line reason.
- Next-charge preview (when active): "Next: $18 on Dec 6, 2026 (6-month anchor)."
- History table: chronological PostRentalCharge rows, status badge, amount, period.
- **Retry button** per failed row → `POST /api/admin/orders/[id]/post-rental/retry` with `{ chargeId }`. Flips row back to `scheduled` (clears `failureCode`/`failureMessage`), audits `PostRentalChargeRetry`. The cron's next run picks it up — or call the same Pass-2 inner function inline for instant retry.
- **Opt-in toggle** for `postRentalEnabledOverride` → `PATCH /api/admin/orders/[id]/post-rental/override` with `{ enabled: boolean, reason?: string }`. Admin-only, audited.

## 9. Backfill policy

- Dormant via env var (`POST_RENTAL_BILLING_START_AT` default `2099-01-01`).
- Per-order opt-in via `postRentalEnabledOverride` toggle in admin UI — the ONLY way to bring grandfathered orders onto the schedule this round.
- **No mass-backfill UI, no CSV upload, no bulk script.** Ryan flips orders one at a time as he negotiates with relationship customers.

## 10. Pickup integration

In `app/api/admin/service-requests/[id]/route.ts` at the spot that flips `Installation.status = 'removed'` (line 147-153), add (within the same transaction):

```ts
// Stop the rental clock the instant pickup completes.
await tx.order.update({
  where: { id: installation.orderId },
  data: { postRentalStoppedAt: new Date() },
});
await audit({ action: AuditAction.PostRentalStopped, ... });
```

Similarly in `app/api/installations/[id]/schedule-removal/route.ts` (line 43-49) — set `postRentalStoppedAt` when `Installation.removalDate` is first written. The cron's eligibility predicate also catches this as a defense-in-depth, but stopping at the source is cleaner.

## 11. Edge cases

| Case | Behavior |
|---|---|
| No card on file | `failureCode='no_payment_method'`, row → `failed`, **no admin email**, visible in admin Rental card with retry button. |
| Stripe decline (`card_declined`, `insufficient_funds`, etc.) | Row → `failed`, audit, admin email. `attemptCount` tracks retries; alert flagged `[ESCALATION 7+ days]` when `attemptCount >= 7`. |
| Order refunded after rental fired | Rental charges **stand**. Admin can manually refund the PI via Stripe dashboard (link from admin Rental card history row). |
| `installedAt < BILLING_START_AT` and no override | Eligibility predicate returns `{ eligible: false, reason: 'grandfathered' }`. Cron never inserts rows. |
| Pickup mid-period | **No prorate.** The $18 covering months 7-9 stands even if pickup at month 7.5. Eligibility predicate sets `postRentalStoppedAt` and stops creating future rows; in-flight `scheduled` rows whose `periodStart <= now` still fire on the next cron pass. **Cancel rule:** in Pass 2, before charging, re-check eligibility — if `postRentalStoppedAt` is now set AND `periodStart > postRentalStoppedAt`, mark `skipped` with reason `pickup_before_period`. |
| Concurrent cron runs | DB unique constraint + atomic `updateMany` reserve + Stripe `idempotencyKey` = three layers of dedupe. |
| Customer changes default card mid-cycle | `resolveBillingPayer` reads current default at charge time — picks up the new card automatically. |

## 12. Effort estimate — 5h total

| Piece | Effort |
|---|---|
| Schema + migration + audit constants | 0.5h |
| `isOrderRentalEligible` + `chargesDue` + `resolveBillingPayer` helper + unit tests | 1.0h |
| Cron endpoint (Pass 1 + Pass 2 + dry_run) | 1.5h |
| Email helpers (receipt + admin alert) | 0.5h |
| Pickup integration (2 call sites) | 0.25h |
| Admin Rental card + 3 API routes (GET / retry / override) | 1.0h |
| Manual verify against synthetic order + tsc | 0.25h |

## 13. Specialist contracts

### Schema specialist
**Deliverable:** Prisma migration + `lib/audit.ts` constants.
- Add `PostRentalCharge` model, `PostRentalChargeType` enum, `PostRentalChargeStatus` enum (section 1 verbatim).
- Add `postRentalEnabledOverride`, `postRentalStoppedAt`, `postRentalCharges` relation to `Order`.
- Add 8 new `AuditAction` constants (section 1).
- Run `npx prisma migrate dev --name post_rental_charges`.
- Verify `npx tsc --noEmit` clean.

### Cron specialist
**Deliverables:**
1. `lib/post-rental/eligibility.ts` — `isOrderRentalEligible({ order, now, billingStartAt })` per section 2.
2. `lib/post-rental/charges-due.ts` — pure `chargesDue(installedAt, now): DueCharge[]` per section 3. Use `date-fns/addMonths`.
3. `lib/post-rental/billing-payer.ts` — `resolveBillingPayer(order)` mirroring `lib/orders/refund-recipient.ts` shape, returns `{ userId, stripeCustomerId, paymentMethodId | null }`.
4. `app/api/cron/post-rental-billing/route.ts` — Pass 1 + Pass 2 + `?dry_run=true` per section 4. Header comment documents the daily-8am-ET schedule and the `POST_RENTAL_BILLING_START_AT` switch.
5. `lib/email.ts` — `sendPostRentalChargeReceipt` (section 6) and `sendAdminChargeFailureAlert` (section 7) signatures exact.
6. Pickup integration patches at the 2 call sites in section 10.
- Strict TS, no `any`. One-line WHY comments. `audit()` calls never thrown.

### Admin UI specialist
**Deliverables:**
1. `<PostRentalCard>` React component, mounted on `/admin/orders/[id]` page (find by grep for existing admin order detail card layout).
2. `GET /api/admin/orders/[id]/post-rental` — returns the section-8 response shape. Admin-auth gated via `requireAdmin()` from `@/lib/auth-utils`.
3. `POST /api/admin/orders/[id]/post-rental/retry` — body `{ chargeId: string }`. Flips the named PostRentalCharge from `failed` → `scheduled` (clears failure fields), audits `PostRentalChargeRetry`. Admin-only.
4. `PATCH /api/admin/orders/[id]/post-rental/override` — body `{ enabled: boolean, reason?: string }`. Updates `Order.postRentalEnabledOverride`, audits `PostRentalOverrideToggle` with before/after values. Admin-only.
- Status badge colors: active=green, grandfathered=gray, stopped=blue, exempt=purple, never_eligible=gray.
- History table sorted by `periodStart DESC`. Retry button only on `status='failed'` rows.
- Next-charge preview computed by calling `chargesDue` against installedAt + filtering out PostRentalCharge rows that already exist for that periodStart, then taking the earliest.