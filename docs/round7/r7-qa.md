---

### Per-item verdict

- **A1 — Shared `lockboxDescriptionSuffix` helper** (`lib/orders/lockbox-description.ts`): **PASS**. Clean prefer-order, idempotent companion `hasLockboxIdentifier`, well-documented. No `any`.
- **A2 — `review-step.tsx` uses shared helper**: **PASS**. Diff matches claim, behavior preserved (serial+code → serial → code → ""), import path correct.
- **A3 — Backfill script** (`scripts/_backfill-lockbox-descriptions.ts`): **PASS**. Idempotent guard via `hasLockboxIdentifier`, ran cleanly, single `inventory.reassign.bulk` audit row with tagged metadata, narrows nullable `customerLockboxId` correctly. Uses Prisma + pg adapter (matches project pattern).
- **A4 — Live backfill ran**: **PASS**. PJ Elder's row is updated (see below). All 3 FK-eligible rows enriched; 19 FK-less rows correctly skipped.
- **B1 — `ExistingLockboxSummary` + shared formatters in `lib/email.ts`**: **PASS**. `formatExistingLockboxLineHtml` escapes type/serial/code; `renderExistingLockboxesHtml` short-circuits on empty/undefined. Pink `#FFE4EC` / `#E84A7A` border visually distinct from yellow special-instructions block. No `any`.
- **B2 — All 4 SR email helpers extended**: **PASS**. New `existingLockboxes?` props are optional everywhere; plain-text and HTML variants render the same line shape; absent/empty input renders nothing.
- **B3 — `installations/[id]/service-request/route.ts`**: **PASS**. Single Prisma query with `include` (no N+1), filters `removedAt: null`, passes `undefined` when empty. Existing try/catch around both email sends preserved.
- **B4 — `service-requests/route.ts`**: **PASS**. Only includes lockboxes when unlisted-address lookup found an installation; gracefully empty otherwise. try/catch preserved.
- **B5 — `admin/service-requests/[id]/route.ts`**: **PASS**. Lockbox fetch is inside the outer try/catch + `.catch()` on each send; only triggers when `statusChanged` and an installation is linked. The extra `prisma.installation.findUnique` is a redundant round-trip (the route already loaded `updated.installation` upstream) — **NEEDS-FIX (LOW)**, optional cleanup; behavior is correct, just slightly wasteful.

No HTML-escape gaps, no `any`, all email sends remain wrapped in try/catch (or `.catch()` on the promise) so a Resend hiccup can't break the route.

### PJ Elder backfill confirmation

DB query against `PPI-MPZUUVAG-4DFJ` lockbox item `cmpzuuvam00av15qs769je5g2`:

```
description: "Sentrilock/Supra Install — Code: 2093483"
customerLockboxId: "cmp05jmns00as15l6wtsk3gd9"
```

Code `2093483` matches the screenshot value Ryan saw in inventory. Backfill counts across the FK-set lockbox population: `scanned: 3, enriched: 3`. Idempotency verified (the script was a no-op on rows already containing `Serial:`/`Code:`).

### Typecheck status

`npx tsc --noEmit` → exit code 0. Clean.

### Test emails (Resend ids)

Sent to `tannercarlson@vvsvault.com` (ADMIN_EMAIL overridden for E3):

- **E1** — `sendServiceRequestConfirmationEmail` WITH `existingLockboxes` (1 lockbox, serial + code): `bd9f0f43-6e94-4fc3-9efa-c5ec701de83c`
- **E2** — `sendServiceRequestConfirmationEmail` WITHOUT `existingLockboxes` (control): `3203b5ee-fe7d-48c2-91ec-10d072abc8a9`
- **E3** — `sendAdminServiceRequestNotification` WITH 2 `existingLockboxes` (serial+code, then code-only): `84cbb0f0-50c8-4286-a67e-2f6a6ed48dbe`

Visual check the human reviewer should confirm in inbox:
- E1: pink "Existing lockboxes at this property" block renders above the yellow special-instructions block, with `Sentrilock/Supra — Serial: TEST-1234  Code: 5678`.
- E2: NO pink block anywhere; yellow special-instructions block still present.
- E3: plain-text admin email contains an `Existing lockboxes at this property:` section listing both lockboxes.

### Recommendation

**SHIP.** All claimed behavior verified:
- PJ Elder's lockbox code (`2093483`) is now in the OrderItem description text and will surface in admin order detail, customer order detail, and any re-sent confirmation.
- All 3 historically-eligible rows backfilled; 19 FK-less rows correctly left untouched.
- New SR templates carry a pink existing-lockboxes block that all 4 helpers render consistently, with HTML escaping on every interpolated field and no `any`.
- All email sends are wrapped so a Resend failure cannot 500 the route.
- `npx tsc --noEmit` is clean.

One follow-up nit (LOW): in `app/api/admin/service-requests/[id]/route.ts`, the new `prisma.installation.findUnique({ include: { lockboxes: ... } })` could be folded into the existing `updated` include further up the route to avoid an extra round-trip. Not blocking — current code is correct, just one query heavier per status transition. The schema-level fix (add `InstallationLockbox.customerLockboxId` FK so the 95% NULL-code rows can derive code from inventory) is still the real long-term win and should land as its own PR.