# Backlog catch-up — implementation plan (2026-09-19)

**Green-lit by Tanner 2026-09-19: "Yes, green light on everything. We're way behind at the moment. Plan properly then start implementation."**

Six workstreams. Ryan has been waiting 11 days on W2 and W3 (answered the open
questions 2026-09-08, chased both 2026-09-14).

---

## Sequencing and why

W2, W3 and W5 all rewrite the same four files — `app/api/orders/route.ts`,
`app/api/orders/batch/route.ts`, `app/api/orders/[id]/edit/route.ts` and
`components/order-flow/steps/review-step.tsx`. Running them concurrently would
be a merge fight over the money path, so the heavy three are strictly
sequential. W4 and W6 barely overlap anything and are the filler for review
cycles.

| # | Slice | Effort | Why here |
|---|---|---|---|
| 0 | W1 tax display + W4 "My own post" | ~0.5 d | W1 is done; W4 is tiny and stops agents mis-ordering *today*. W4 lands in post-step, which W5 later rewrites — so it goes first. |
| 1 | W2 out-of-area by route miles (+ broker exemption) | ~2 d | Ryan chasing. Also stops an active money leak: brokers pay no OOA fee at any distance. |
| 2 | W3 linked brokerage inventory | ~3 d | Ryan chasing equally hard. Biggest and most security-sensitive — carries the mandatory ownership-check fix. |
| 3 | W5 sign selection + $10 pickup fee | ~1.5 d | Newest of the money work; Ryan expects it after the two he's chasing. |
| 4 | W6 active posts view | ~1 d | Isolated (new page, read-only). Can be pulled forward into any review cycle. |

Each slice ships on its own: tsc → lint → adversarial review (money/auth/
multi-file) → commit → FF-merge to `main` → Railway deploy → Slack note to Ryan.
Nothing waits for the whole batch.

---

## W1 — $40 no-post fee: displays match the charge ✅ done, pending review

Tanner picked Option B (2026-09-19): keep the fee taxable, make every screen
agree with what is actually charged.

The server's canonical helper puts the $40 in the tax base
(`lib/orders/pricing.ts:138`). Three places did not mirror it, so the same
order was taxed three different ways:

| path | before | after |
|---|---|---|
| cart / batch | client quoted $30 base, server charged $70 base → **$2.40 under-quoted** | agree |
| single order, Stripe Tax answers | both excluded the $40 → agreed, but $2.40 *below* the documented rule and below the cart | agree |
| single order, Stripe Tax returns 0 / throws | client excluded, 6% fallback included → **$2.40 under-quoted** | agree |

Changes:
- `components/order-flow/steps/review-step.tsx` — `buildTaxItems()` pushes the
  $40 when `!formData.post_type`. Condition mirrors the server's
  `hasPostType: !!post_type` exactly, so an `open_house` order (truthy
  post_type, no surcharge) correctly adds nothing.
- `app/api/orders/route.ts` — the fee joins the Stripe Tax line items next to
  the expedite fee. It is not in `orderData.items` (the helper derives it from
  `hasPostType`), so it must be pushed explicitly. Placed before the
  discount block so index 0 stays a real item.
- Same file, `buildTaxItems` deps — `wood_panel_sign_build`,
  `wood_panel_materials` and `lockboxInstall` were read inside but missing
  from the dep array, so toggling a Wood Panel add-on left the tax preview
  stale. Same bug class, fixed alongside.

Batch and edit need no change: they use the helper's 6% fallback with no
`taxOverride`, which already includes the $40.

**Correction to what I told Tanner:** I said Option B meant "no dollar changes
for anyone." That was wrong on one branch — a single order where Stripe Tax
answers now pays ~$2.40 more, matching the documented rule and the cart. No
path is charged *above* its quote any more.

Verified by an 8-case check that the client base and server base now produce
an identical figure across: no-post, with-post, open_house, expedited+no-post,
and discounted+no-post.

## W4 — "My own post" at $59

Ryan 2026-09-18: *"These dang agents keep selecting 'no post' if they have
their own. Please place another selection for 'My own post' under the posts
portion of the order and it's still $59."*

The pull is obvious: "No Post Needed" is the only option that looks like "I
have my own", and it charges the $40 service-trip fee instead of $59. A named
option removes the ambiguity.

**Scouted 2026-09-19.** `post_type` is a plain string matched against
`PostType.name` (`app/api/orders/route.ts:504-518`), so this needs:
1. A `PostType` row named **"My Own Post"** — a prod INSERT, so **Tanner runs
   the script** (the classifier blocks prod writes here).
2. `components/order-flow/types.ts:33` — add to the `post_type` union, and
   `PRICING.posts` (`:184-190`) gets `'My Own Post': 59`.
3. `components/order-flow/steps/post-step.tsx` — the tile.
   `review-step` reads `PRICING.posts[post_type]`, so display and the item
   line follow for free.

**Two things the scout turned up that matter:**

- **Post-rental billing must be off for it.** `app/api/orders/route.ts:568`
  sets `postRentalDisabled: !orderData.post_type` — i.e. any real post enables
  long-term rental billing. We cannot bill rent on a post we don't own, so
  "My Own Post" has to force `postRentalDisabled: true`. Dormant today
  (`POST_RENTAL_BILLING_START_AT` defaults to 2099) but wrong the day it's
  switched on.
- **`PostType.price` is dead data.** Prod has White/Black Vinyl at $55 while
  `PRICING.posts` charges $59, and the two never meet: the column is read
  **nowhere** in the codebase (only mentioned in a comment at
  `lib/dispatch/load-jobs.ts:60` saying it is deliberately not selected).
  Item prices come from the client constant. So the stale $55 is cosmetic, not
  a money bug — noting it rather than "fixing" it, since touching a price
  column nobody reads is pure risk. Flag for Ryan separately.

## W2 — Out-of-area fee by route miles

Full spec: [`docs/out-of-area-miles/design.md`](../out-of-area-miles/design.md)
(updated 2026-09-19 with Ryan's locked answers).

Headlines: road miles from Google Routes instead of drive minutes; per-city
free radius; $25 covers the first 20 extra miles then $2/mile; **per trip**
(install and pickup, ×2); **no hard distance cutoff**; Middletown and Dayton
are full service points; Bardstown removed; **no policy re-acceptance**.

Plus the confirmed broker leak: `lib/service-area.ts:256` exempts every
`team_admin` from the distance math. Only Semonin actually has
`isServiceAreaExempt` set — the other three brokers are exempt by accident of
role. Dropping the role clause charges Redfin and keeps Semonin exempt.

## W3 — Linked brokerage inventory

Full spec:
[`docs/linked-brokerage-inventory/design.md`](../linked-brokerage-inventory/design.md)
(updated 2026-09-19 with Ryan's locked answers).

Headlines: admin tags an agent to a brokerage; the agent's pickers show the
**whole** brokerage pool plus their own; signs, riders, lockboxes **and
brochure boxes**; the agent pays (inventory link only, never a billing link);
**Phase B cut** — no broker-side visibility, Ryan explicitly declined it.

Carries the mandatory ownership check: today no ordering path verifies that a
`customer_*_id` belongs to the person ordering. Harmless while nobody can see
anyone else's items; a shared pool makes broker ids discoverable, so the check
becomes a build requirement.

## W5 — Sign selection rebuild + $10 pickup fee

Ryan 2026-09-15 plus three follow-ups. Nothing pre-selected; three top-level
options; the "at property or picked up elsewhere" option opens a dropdown
(at the listing property / delivered to a Pink Posts storage location / picked
up from another location **+$10** with a required pickup address); a
per-broker waiver so Semonin can be exempted; and a note offering one
complimentary first pickup via 859-395-8188. Riders are explicitly out of
scope for pickup ("It's rare that we're picking up only riders. It does happen
but I can figure that out later").

**Scouted 2026-09-19. Three decisions the scout forced, each avoiding a real bug:**

1. **The fee gets its own `item_type: 'pickup_fee'` — NOT `'surcharge'`.**
   Reusing `'surcharge'` looked right (it is the untaxed-service-charge type)
   but breaks two things:
   - `lib/dispatch/types.ts:39-41` excludes `'surcharge'` from the installer
     email by design — and the crew is *precisely* who needs the pickup
     address.
   - `app/api/orders/[id]/edit/route.ts:437,524-529,665` special-cases
     `'surcharge'` rows for out-of-area reconciliation. A second surcharge row
     would be swept into that math and mis-reconciled on every edit.

   A dedicated type added to the Zod allowlist (`lib/validations.ts:22` — a
   hard blocker; the POST/PATCH 400s without it) plus an explicit exclusion in
   `computeOrderPricing`'s tax filter gets the untaxed treatment without
   either collision.
2. **The pickup address rides in `OrderItem.description`, not a new column.**
   Precedent: lockbox serial+code and custom rider names already travel this
   way (`review-step.tsx:933-935`). It reaches the admin detail page, both
   notification emails and the invoice PDF for free. A new `Order.pickupAddress`
   column would mean touching 12 more files for no gain.
   ⚠️ **The description must contain no dollar amount.** Dispatch runs every
   string through `assertNoMoney` (`lib/dispatch/money.ts`) and *throws, killing
   the entire send*, on a `$\d` match. "Sign pickup — 123 Main St", never
   "Sign pickup ($10)".
3. **The waiver is Team-level, not User-level.** Ryan said "broker accounts…
   Semonin mainly", which is a brokerage, not one login. Follows
   `Team.freeLockboxInstall` (`prisma/schema.prisma:167-170`) — fetched in
   `place-order` and both edit pages, passed down as a numeric override prop
   the way `lockboxInstallFee` already is. Unlike that flag, this one gets a
   real admin toggle rather than being set by a DB script.

**No flat-fee change needed.** `computeFlatFeePricing` ignores `items[]`
entirely and returns a fixed total, so the $10 is already money-invisible for
flat-fee accounts while still persisting for fulfillment. But the client
preview renders every line (`review-step.tsx:1370`) alongside the flat-fee
panel (`:1439-1457`) — verify the $10 doesn't display a charge a flat-fee
customer won't pay.

**Also:** `lib/orders/order-history-pdf.ts:26-39` hard-codes item types and
falls back to "N items", so a new type silently vanishes from the history-PDF
summary. Add it there.

**Second post:** has the same ambiguous tile (`second-post-step.tsx:214-226`),
but a second $10 pickup on the same trip to the same address is not intended.
The dropdown gets mirrored; the fee does not.

## W6 — Active posts view

Ryan 2026-09-19: *"I need a way to see our active posts. Too many agents are
forgetting to ever schedule removal. If there's a way to see active posts out
there and search by both street name as well as filter oldest/newest."*

**Scouted 2026-09-19.** This is a NEW admin page — `app/admin/` has no
installations list at all, and `/api/installations` is hard-scoped to
`userId: user.id`, so nobody can see across customers today. The admin
overview already counts active installs
(`app/api/admin/stats/route.ts:52-54`) as a dead-end tile; the new page is
what that tile should link to.

**The cohort Ryan actually wants.** `InstallationStatus` is
`active | removal_scheduled | removed` (`prisma/schema.prisma:840-844`).
"Still out" is `active` or `removal_scheduled`, but "agents forgetting to ever
schedule removal" is precisely **`status='active'` AND `removalDate IS NULL`**.
`Order.postRentalStoppedAt` is stamped the moment a removal is scheduled
(`schedule-removal/route.ts:55-59`), so `postRentalStoppedAt IS NULL` is the
same signal maintained from the other side — a useful cross-check, not the
primary filter.

**Design**
- `GET /api/admin/installations` — admin-only, matching the hand-rolled check
  in `app/api/admin/orders/route.ts:13-15`. Params: `search`, `status`,
  `sort=oldest|newest`, `limit`/`offset` (PAGE_SIZE 25, the admin convention).
- Search is **server-side** `contains` + `mode: 'insensitive'` over
  `propertyAddress` and `propertyCity`, following
  `app/api/admin/customers/route.ts:43-51`, debounced 300 ms like
  `app/admin/customers/page.tsx:86-88`. Substring, so "main" finds
  "309 West Main Street". Not the client-side `SearchableSelect` matcher —
  that one filters an already-fetched array, which does not survive
  pagination across every customer.
- Sort on `installedAt` (populated on every row via `@default(now())`, stamped
  when an admin completes the order). **Default oldest-first** — the whole
  point is finding the ones that have been out longest.
- Columns: address, customer, agent (`order.placedForAgentName`), installed
  date, **days out**, status, scheduled removal date. There is no days-out
  helper anywhere in the repo, so one gets written.
- `/admin/installations` page follows `app/admin/orders/page.tsx`: client
  component, `<Suspense>` wrapper, URL-as-source-of-truth for filters,
  AbortController per fetch, the standard table markup and pink accents.

**Index note.** `Installation` has **no `@@index` at all** — a cross-customer
list filtered on `status` and sorted on `installedAt` would seq-scan the whole
table. Additive indexes on `(status, installedAt)` and `propertyAddress` go in
with this (safe `db push`, no data change).

**Two bugs found while scouting — fixing along the way** (Tanner, 2026-09-19:
"always fix those along the way"):
1. `app/dashboard/page.tsx:112-118` renders a **search input with no `value`
   and no `onChange`** — it looks functional and does nothing. An agent
   hunting their own listing types into it and gets no response.
2. The same page's "Active Installations" section fetches `/api/installations`
   with no status filter and renders **every** install including `removed`
   (`app/dashboard/page.tsx:15-51, 106-139`) — only the stats tile filters.
   The heading is simply wrong. The API already supports `?status=`; no UI
   ever passes it.

Both are on the exact "agents can't find / can't see their active posts"
surface this request is about, so they ship with it.

---

## Standing constraints

- `.env.local` is the **real** production database and a **live** Stripe key.
  No sandbox. Money work gets the adversarial review gate without exception.
- One-off scripts are `scripts/_*.ts` and are deleted after the run; never
  committed.
- Prod DB *writes* are handed to Tanner to run in PowerShell — the classifier
  blocks them here. Read-only probes run fine.
- Commits: `<scope>: <what> (Slack request from Ryan)`, branch
  `ryan-feedback-2026-06-02`, FF-merge to `main`, Railway auto-deploys.
- Slack replies to Ryan: plain English, first person, no jargon.
