All deliverables complete.

---

**FILES CREATED / MODIFIED**

- `c:/Users/tanne/PPI/lib/post-rental-billing.ts` — pure helpers (`chargesDue`, `isPostRentalEligible`, `getBillingStartAt`, `addMonths`) plus the dormant-default `BILLING_START_AT`
- `c:/Users/tanne/PPI/app/api/cron/post-rental-billing/route.ts` — GET handler with CRON_SECRET bearer auth, two-pass logic, atomic reserve, idempotency key, receipt + admin-alert emails, `?dry_run=true` support, `resolveBillingPayer` ladder
- `c:/Users/tanne/PPI/lib/email.ts` — appended `sendPostRentalChargeReceipt` (pink-header HTML, gated by `emailOrderConfirmations`) and `sendAdminChargeFailureAlert` (text format, escalation prefix at attempt 7+)
- `c:/Users/tanne/PPI/.env.example` — documented `CRON_SECRET` + `POST_RENTAL_BILLING_START_AT` with dormant default
- `c:/Users/tanne/PPI/scripts/_dryrun-post-rental-cron.ts` — standalone verification script (raw Prisma, no Next path-aliases needed)

**PRODUCTION SCHEDULE** (documented in route file header): Railway Cron Service plugin (or any external scheduler) hits `GET /api/cron/post-rental-billing` with `Authorization: Bearer ${CRON_SECRET}` once daily at 8am ET (13:00 UTC). One run/day is sufficient — the `(orderId, periodStart)` unique constraint + atomic `updateMany` reserve + Stripe `idempotencyKey` give three layers of dedupe.

**TSC**: `npx tsc --noEmit` clean for all files I authored. The two remaining errors in the repo (`PostRentalCard` reference in `app/admin/orders/[id]/page.tsx`, `_explore-rental-base.ts` downlevel-iteration) are owned by Specialist C and pre-existing.

**DRY-RUN OUTPUT against live DB with dormant default:**

```
[dry-run] now=2026-06-06T23:20:58.018Z
[dry-run] BILLING_START_AT=2099-01-01T00:00:00.000Z
[dry-run] env POST_RENTAL_BILLING_START_AT=(unset - dormant default)
[dry-run] scanned 139 candidate orders
[dry-run] eligible: 0
[dry-run] would-schedule charge rows: 0
[dry-run] skipped breakdown:
           grandfathered                134
           exempt_role_team_admin       5
[dry-run] existing scheduled rows already due: 0
```

Confirmed: ZERO due charges with dormant default. 134 historical orders correctly grandfathered, 5 team_admin orders correctly exempt, zero would-schedule rows, zero existing scheduled rows.