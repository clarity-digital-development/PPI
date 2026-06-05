Good — no duplicate prefs UI in admin. Compiling audit.

---

# Auditor B — /admin/settings audit

**File:** `app/admin/settings/page.tsx` (652 lines, client component, admin-only route)
**APIs hit:** `/api/admin/settings/email` (GET/POST), `/api/admin/promo-codes` (GET/POST), `/api/admin/promo-codes/[id]` (PUT/DELETE)

## Section-by-section

| # | Section | Lines | Status | Notes |
|---|---|---|---|---|
| 1 | Payment Settings card | 211-236 | **DECORATIVE** | Two hardcoded Badges: "Stripe Integration: Configured" (L225) and "Webhook: Active" (L229). Never checks env or pings Stripe. Footer text (L232) tells admin to update env vars via deployment — no UI action. Lies if `STRIPE_SECRET_KEY` is missing. |
| 2 | Email Notifications card | 239-323 | **PARTIAL (read-only + test send)** | GET `/api/admin/settings/email` (route.ts L5-29) returns `{ resendConfigured: !!process.env.RESEND_API_KEY, adminEmail: process.env.ADMIN_EMAIL, fromEmail: 'orders@pinkposts.com' }`. `fromEmail` is **hardcoded** in the API (L23) — admin cannot change it; if a future deploy swaps domains, display lies. `adminEmail` shown is the env var, not stored in DB — no edit UI. "Send Test Email" button (L286-304) → POST `{ action: 'test' }` → fires a Resend email to `process.env.ADMIN_EMAIL`. Works. **Logs the API key prefix to console** (route.ts L57) — low-sev info leak in server logs. |
| 3 | Business Settings card | 326-364 | **DECORATIVE (worse: stale)** | Every value is hardcoded JSX. Fuel Surcharge `$2.47` (L340) — matches `FUEL_SURCHARGE` in `lib/orders/pricing.ts:7`. Expedite Fee `$50.00` (L344) — matches `EXPEDITE_FEE` in `lib/orders/pricing.ts:10`. Rider Install `$2.00` (L348) — matches `components/order-flow/types.ts:141` and `RiderSelector/constants.ts:122`. Rider Rental `$5.00` (L352) — matches `types.ts:140`. Sales Tax `6%` (L356) — matches `FALLBACK_TAX_RATE` in `pricing.ts:9`. Service Area `Kentucky, Ohio` (L360) — **STALE/WRONG**: `lib/constants.ts:4` says "Central Kentucky" only; no Ohio service area anywhere in code. **No edit controls, no API, no DB row.** If pricing constants change, this card silently lies. |
| 4 | Admin Users card | 367-389 | **DECORATIVE** | One static "Database Managed" badge. Footer (L384-387) literally tells the admin to open Prisma Studio. No list of admins, no add/remove. |
| 5 | Promo Codes section (full-width) | 393-648 | **WORKS** | Real CRUD wired to `/api/admin/promo-codes` (GET L19-41, POST L43-92 — zod validated, dedupe-checked) and `/api/admin/promo-codes/[id]` (PUT L51-109, DELETE L111-156 — soft-deletes if used). `waiveFuelSurcharge` is passed on create (page L117) but **dropped on edit** (PUT schema `[id]/route.ts:6-16` has no `waiveFuelSurcharge` field) → PARTIAL: a code's waive flag is set-once. Page also never lets the admin edit `description`, `discountType`, `discountValue`, `code`, `minOrderAmount`, or `startsAt` after creation — only toggle active and delete. `minOrderAmount` field exists in the API schema but has **no UI input** at all. |

## API endpoint reality

| Endpoint | Method | Persists? | Notes |
|---|---|---|---|
| `/api/admin/settings/email` | GET | No | Reads env at request time |
| `/api/admin/settings/email` | POST `{action:'test'}` | No | Fires Resend email; logs API key prefix |
| `/api/admin/promo-codes` | GET / POST | Yes (`PromoCode` table) | Real CRUD |
| `/api/admin/promo-codes/[id]` | GET / PUT / DELETE | Yes | DELETE soft-deactivates if `_count.orders > 0` |

**No other `/api/admin/settings/*` endpoints exist.** No endpoint persists fuel surcharge, expedite fee, rider prices, tax rate, service area, `ADMIN_EMAIL`, `fromEmail`, or admin-user list. Those are env vars or hardcoded constants. A "system_settings" table does not exist.

## Comparison to /dashboard/profile

- `/dashboard/profile` Notification Preferences card has 4 user-facing email/SMS opt-out checkboxes, all `defaultChecked={pref.checked}` from a local array — **no onChange, no API, no DB column**. Schema (`prisma/schema.prisma` grep) has zero columns matching `notification|preference|optOut|unsubscribe` on `User`.
- `/admin/settings` has **no parallel notification-preference UI** — only the read-only "Resend configured / admin email / send test" card. So there is no duplication risk today; whatever opt-out system we build on `User` can live entirely behind `/dashboard/profile` without conflicting with admin settings.
- Implication for Peggy/Semonin: a real opt-out requires (a) `User.notificationPrefs` JSON or columns, (b) honoring them in every Resend call site (`lib/email.ts` + service-request status email paths + admin notifications — admin notifications should **not** honor per-customer prefs since they go to `ADMIN_EMAIL`), and (c) wiring `/dashboard/profile` checkboxes to a new `PATCH /api/profile/notifications` endpoint. None of that exists yet.

## Bugs / gaps found (ranked)

1. **P1 — Business Settings card shows "Kentucky, Ohio"** (L360) but service area is Central Kentucky only per `lib/constants.ts:4`. Either fix the marketing copy or fix this card. Decorative card lying to admins about service area is a sales-call risk.
2. **P2 — Payment Settings badges are unconditional** (L225, L229). Should at minimum check `!!process.env.STRIPE_SECRET_KEY` and `!!process.env.STRIPE_WEBHOOK_SECRET`. Same fix shape as the Resend card.
3. **P2 — Promo code edit drops `waiveFuelSurcharge`** (`[id]/route.ts:6-16` schema omits it). Toggle/edit a code → loses the flag silently. Either add it to the update schema, or remove the create-time field until edit supports it.
4. **P3 — Hardcoded `fromEmail: 'orders@pinkposts.com'`** in `app/api/admin/settings/email/route.ts:23`. Should read from env or `lib/email.ts` constant so the displayed value matches what's actually sent.
5. **P3 — Email route logs `RESEND_API_KEY?.substring(0,10)`** (route.ts L57). Low-sev info leak in Railway logs; remove or guard behind a debug flag.
6. **P3 — No UI for `minOrderAmount`** on promo create form even though API supports it (`route.ts:11`). Dead capability.
7. **P3 — Promo edit UI is missing entirely**. Can only toggle active / delete. Typos in `code`, `description`, `discountValue` are unfixable from the UI.
8. **P4 — Business Settings constants are scattered.** Fuel surcharge, expedite fee, rider prices, and tax rate live in three different files (`lib/orders/pricing.ts`, `components/order-flow/types.ts`, `components/order-flow/RiderSelector/constants.ts`). Risk of drift; the settings card has no enforcement that what it displays is what's used. If we ever make these admin-editable, consolidate into one source.

## Recommendations (for the Peggy opt-out work)

- Build user-side opt-outs entirely under `/dashboard/profile` + a new `User.notificationPrefs` JSON column. Do **not** add a preference UI to `/admin/settings` — that page is for system config, not per-user prefs.
- For team_admins like Peggy, also consider a team-level "digest mode" (one daily summary instead of per-order/SR emails). Current admin settings page is the wrong home for that; it belongs on a per-team settings surface (which does not appear to exist yet — separate audit needed).

**Word count: ~970.**