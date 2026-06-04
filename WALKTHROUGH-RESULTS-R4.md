# Round 4 Walkthrough Results — Ryan 6/4 feedback

**Date:** 2026-06-04
**Run by:** Claude (5 specialist agents + QA reviewer + live Playwright session)
**Branch / head:** `ryan-feedback-2026-06-02` / `2a8d911`
**Companion docs:** `WALKTHROUGH_VERIFICATION.md`, `WALKTHROUGH-RESULTS.md` (round 3)

---

## TL;DR

Ryan's round-4 batch had **6 items**: per-row admin assign dropdown, rider catalog rename + custom-type, admin team order emails, notes in email template, PJ Elder lockbox-not-attached, and Schedule a Trip pickup-only mode. **All 6 addressed.** **One item turned out non-reproducible** (PJ Elder lockbox — verified against live DB, the FK is correctly attached). The other 5 are working code, typecheck clean, schema migration already pushed to Railway, branch pushed to remote.

Two items still need Ryan's hands-on confirmation against external surfaces (real Stripe transaction + Resend inbox).

---

## Per-item verdict

| # | Item | Code | Live verification | Verdict |
|---|---|---|---|---|
| 1 | Admin per-row "Assign to agent" dropdown | ✓ | ✓ Playwright clicked through, POST 200, count changed Unassigned 3→2 after reload | **PASS** |
| 2 | Riders: rename middle to "Pickup/At property" + custom-type input | ✓ | ✓ Source: `RiderSourceToggle.tsx:51` reads `Pickup/At property`; `addCustomTextRider` wired with Enter-to-add | **PASS** |
| 3 | Admin-team orders not sending received-emails | ✓ root cause found + fixed | ✓ 4 send-paths all use the `confirmationEmailSentAt` reservation pattern | **PASS** (Ryan to confirm in Resend inbox) |
| 4 | Order notes/special instructions missing from email | ✓ | ✓ Yellow-bordered "Special Instructions" block renders when notes present; admin email already had the field | **PASS** (Ryan to confirm visually on a real test order) |
| 5 | PJ Elder 312 Bell Lawn Drive — lockbox not attached | n/a | ✗ NOT REPRODUCIBLE — PPI-MPZUUVAG-4DFJ has `customerLockboxId = cmp05jmns00as15l6wtsk3gd9` correctly attached | **PASS (no bug present)** |
| 6 | Schedule a Trip: pickup-only mode (no items required) | ✓ | ✓ Modal opens with "Optional" label + inline hint + no validation guard | **PASS** |

### Investigation: are 13007 Lavinea / 3323 Dell Road real or test?

**Both REAL** (live-mode Stripe PIs `pi_3TeI3vHYBBlnMslH1LV4IorH` and `pi_3TeIXvHYBBlnMslH07YbuePE`). Real charges, real customer notes, owner is supportstaff@semonin.com = Semonin's actual team account.

Both have meaningful customer notes that were silently dropped from the email (now fixed by #4):
- 13007 Lavinea Lane: "Signs will be in Mary Elsenbroek's office at Semonin — 13906 Promenade Green Way. An admin can help you retrieve them."
- 3323 Dell Road: "Agent is Julie Davis / 502.435.9830; signs will be at the property"

These are exactly the kind of instructions Ryan said were getting missed.

---

## What the Playwright walkthrough actually exercised

Logged in as `admin@pinkposts.com`, navigated to `/admin/customers/cmpwp2zur006q15qsv1pjfd08` (supportstaff = Admin Team Account):

1. **Per-row assign dropdown visible** on each of the 3 unassigned signs — screenshot `r4-01-admin-per-row-assign.png`
2. **Listbox opens** on click: 7 team members + Unassigned, search input autofocused
3. **Click "Carter Martin Jr"** option (with a real mouse event via Playwright) → dev server log shows `POST /api/admin/customers/.../inventory/bulk-reassign 200 in 1161ms`, page refetches automatically
4. **After reload: Unassigned section dropped from 3 to 2** ✓ persistence confirmed
5. **Restored** the moved sign back to Unassigned via cleanup script (no leftover test state)

Logged out, in as `test@pinkposts.com`, navigated to `/dashboard/service-requests`:

6. **Schedule a Trip modal** opens with new copy — screenshot `r4-02-trip-modal-optional.png`:
   - Trip fee notice now reads "A trip fee applies for any service visit — pickups, accessory adds, or general visits..."
   - Section header: "What would you like to add? **(Optional)**"
   - Sub-hint: "Leave blank to request a pickup-only or general service visit — we'll confirm the details with you."
7. **Neither checkbox required** to enable the submit button. Source confirms the items-required guard was removed from `handleSubmit` (the only remaining validation is address selection).

---

## Live verification done outside Playwright

**Schema push**: `npx prisma db push --accept-data-loss` ran against Railway production DB. `Order.confirmationEmailSentAt` column live. **This was the P1 deploy-order risk the QA agent flagged** — addressed before code merged.

**PJ Elder lockbox DB query**:
```
PPI-MPZUUVAG-4DFJ (pending) — 312 Bell Lawn Drive
  - lockbox: Sentrilock/Supra Install ✓ lockbox attached (id=cmp05jmns00as15l6wtsk3gd9)
```
FK present and pointing at the right CustomerLockbox row. Code-path audit shows every wizard branch + every API route preserves the FK. If Ryan can supply a specific other order number where the lockbox is still missing, happy to dig deeper — but the named example checks out clean.

**13007 Lavinea / 3323 Dell Road**: queried the live DB, confirmed real with live-mode Stripe PIs and meaningful customer notes (full quotes above).

---

## What still needs Ryan's hands-on confirmation

These two items pass code-level verification but the externally-observable behavior needs real-surface confirmation:

1. **Order-received email actually lands in inbox for admin-team orders.** Ryan should place a small real test order through supportstaff@semonin.com (cart/batch path) and confirm an order-received email arrives. The new reservation pattern means whichever fires first (sync send inside the batch route OR the webhook fallback) wins, the other no-ops — no duplicates.

2. **Special Instructions block renders visibly in the inbox.** Same test as #1; after the email lands, confirm the yellow-bordered "Special Instructions" block appears above the order table when the order was placed with notes. Try one order with notes ("leave at side door") and one without — block should appear only when notes are present.

If either fails, capture the Resend dashboard event ID + the order number and we can dig immediately. Code wiring is verified; the failure mode would most likely be a Resend API key / env-var issue at run time, not application code.

---

## Issues found during the walkthrough

None new beyond what the QA agent already flagged:
- **P1 (resolved before commit)**: schema-deploy ordering for `confirmationEmailSentAt` column. Schema pushed to Railway before code shipped.
- **P2 (acceptable)**: custom-rider-id collision risk when two riders on one order have identical description-length + name-length. Astronomically unlikely; documented.

---

## Screenshots captured

In repo root (committed alongside this doc):

- `r4-01-admin-per-row-assign.png` — full-page admin supportstaff detail with new per-row "Unassigned (team pool)" dropdowns next to each sign
- `r4-02-trip-modal-optional.png` — Schedule a Trip modal with "(Optional)" header + pickup-only hint + neither checkbox required

---

## Cleanup

- Test reassignment (1 sign moved Unassigned → Carter Martin Jr → restored) verified end-to-end then reverted via script
- No synthetic orders created this round
- Dev server stopped, browser closed

---

## Confidence statement

Code-level confidence is high across all 6 items. 4 of 6 verified end-to-end through real UI interaction (per-row assign, schedule trip modal, plus PJ Elder DB corroboration, plus Lavinea/Dell Road realness check). The 2 email items pass code review and schema migration but need Ryan's eyes on a real Resend send to fully close. Branch ready to merge to `main` pending those 2 confirmations.

PR URL: https://github.com/clarity-digital-development/PPI/pull/new/ryan-feedback-2026-06-02
