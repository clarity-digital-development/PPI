Probes removed. Final report:

---

### Per-piece verdict

**A (Schema + Audit) — PASS.** Migration applied live (Railway Postgres in sync), all columns/enums/indexes present, unique `(order_id, period_start)` constraint enforced at DB level (SQLSTATE 23505 confirmed via direct `pg` driver probe). 8 new AuditAction constants present. tsc clean for A's files.

**B (Cron + charging + email) — PASS WITH ONE GAP.** Cron route is solid: CRON_SECRET fail-closed (503 if unset, 401 on bad bearer), dormant 2099 default, two-pass logic, atomic conditional `updateMany` reserve, Stripe idempotencyKey `post_rental:{orderId}:{periodStart}:v1`, dry-run, pickup-during-period cancel rule, payer ladder mirroring refund-recipient, isUniqueViolation matches Specialist A's adapter-pg warning, audit on every state transition (schedule/attempt/succeed/fail/skip), receipt + admin alert wired with try/catch, escalation prefix at attempt 7+, "no_payment_method" suppressed from admin alerts. **GAP: section-10 pickup integration was claimed but NOT delivered** — `postRentalStoppedAt` is not written in `app/api/admin/service-requests/[id]/route.ts` (line 147-153 unchanged) nor in `app/api/installations/[id]/schedule-removal/route.ts`. The eligibility predicate's defense-in-depth (`installation.removalDate != null` check) catches it on the next cron pass, so the bug is bounded but not "clean at the source" as promised.

**C (Admin UI + APIs) — PASS.** `computePostRentalView` ladder mirrors eligibility; status `active|grandfathered|stopped|exempt|never_eligible`; next-charge preview filters already-scheduled. Retry endpoint: admin-only, validates ownership, requires `failed` status, conditional `updateMany` flip + audit, doesn't call Stripe (correct — cron is the single charging path). Override endpoint: admin-only, no-op fast-path skips audit spam, audits before/after with reason. Admin page mounts the card. tsc clean for C's files.

### Code quality issues

1. **Pickup integration gap (B).** Not wired into the two pickup mutation sites. Should be a 5-line patch in each file inside the existing transaction/update flow.
2. **`admin-view.ts` duplicates `addMonths` + anchor math** rather than importing from `lib/post-rental-billing.ts`. The file's own comment acknowledges this and asks for sync — acceptable but technical debt. Recommend extracting to a shared `lib/post-rental/math.ts` in round-15.
3. **`isPostRentalEligible` swallows `now` via `void now`** (line 187). Pure cosmetic; not a bug.
4. **HTML escape coverage**: receipt HTML correctly `escapeHtml`s every interpolation (`recipientName`, `orderNumber`, `propertyAddress`, dates, cardLast4, typeLabel). Admin alert is plain-text (no HTML risk).
5. **Override endpoint accepts unbounded `reason` string but slices to 500 chars** — defensive, good.
6. No `any` casts in committed code (one `as PostRentalChargeType` and one `as ChargeTypeStr` for Prisma enum string narrowing — acceptable).

### Typecheck status

`npx tsc --noEmit` → **single error in `scripts/_explore-rental-base.ts`** (pre-existing scratch script, untracked, downlevel-iteration on a MapIterator — unrelated to this round). All new/modified files compile clean.

### Safety check: dormant by default?

**PASS.** With `POST_RENTAL_BILLING_START_AT` unset, `getBillingStartAt()` returns `2099-01-01T00:00:00Z`. Live DB probe with that default: **scanned 139 orders, eligible 0, would-schedule 0** (134 grandfathered + 5 team_admin exempt). `getBillingStartAt()` also stays dormant on invalid env values (NaN guard). `.env.example` documents the switch + ships the dormant default. `CRON_SECRET` unset → endpoint 503s.

### Dry-run output

Dormant default (no env override) against live DB:
```
scanned 139 candidate orders
eligible: 0
would-schedule charge rows: 0
skipped: grandfathered=134, exempt_role_team_admin=5
existing scheduled rows already due: 0
```

With `POST_RENTAL_BILLING_START_AT=2025-11-06T00:00:00Z` (7mo ago, no override flips): scanned 139, eligible 134, **would-schedule 0** because no production install is older than ~1 day (newest=2026-06-05). Grandfathering math correct.

### Idempotency check result

**PASS.** Synthetic test (rewound one customer order's `installedAt` to 7mo ago + flipped override=true, computed dues, inserted, re-ran):
- Pass 1: inserted=1 (one $18 six_month at 2026-05-06), dupes=0
- Pass 2 (same data): inserted=0, **dupes=1** → unique constraint blocked the duplicate, only 1 row in DB after both passes
- Direct pg driver probe (Specialist A's `verify-pg-direct.ts`): duplicate insert rejected with `code=23505 constraint=post_rental_charges_order_id_period_start_key`
- All test rows + state cleaned up afterward (installedAt and override restored)

Three layers of dedupe confirmed: (1) DB unique constraint, (2) atomic conditional `updateMany` reserve in cron Pass 2, (3) Stripe `idempotencyKey`.

### Recommendation

**SHIP with one follow-up.** All P0 safety properties hold: dormant default, CRON_SECRET fail-closed, exemptions honored (admin/team_admin/isServiceAreaExempt), unique constraint enforced at DB level, audit on every state change, HTML-escaped emails, no `any` abuse. The cron will not charge anyone until Tanner explicitly sets `POST_RENTAL_BILLING_START_AT`.

**One follow-up before flipping the env var live:** wire `postRentalStoppedAt = new Date()` into the two pickup sites flagged in spec section 10 (`app/api/admin/service-requests/[id]/route.ts` line 147 and `app/api/installations/[id]/schedule-removal/route.ts`). The eligibility predicate's defense-in-depth means this is a polish gap, not a charging-correctness bug — but it's part of what B claimed to deliver and Ryan called it out as "cleaner at the source."

Files referenced:
- `c:\Users\tanne\PPI\prisma\schema.prisma`
- `c:\Users\tanne\PPI\lib\audit.ts`
- `c:\Users\tanne\PPI\lib\post-rental-billing.ts`
- `c:\Users\tanne\PPI\lib\post-rental\admin-view.ts`
- `c:\Users\tanne\PPI\lib\email.ts`
- `c:\Users\tanne\PPI\app\api\cron\post-rental-billing\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\orders\[id]\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\orders\[id]\post-rental\retry\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\orders\[id]\post-rental\override\route.ts`
- `c:\Users\tanne\PPI\app\admin\orders\[id]\page.tsx`
- `c:\Users\tanne\PPI\.env.example`
- Pickup-integration miss: `c:\Users\tanne\PPI\app\api\admin\service-requests\[id]\route.ts` line 147, `c:\Users\tanne\PPI\app\api\installations\[id]\schedule-removal\route.ts`