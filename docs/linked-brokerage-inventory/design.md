# Linked brokerage inventory — design (APPROVED, building)

**Status:** approved, in build · **Requested:** Ryan, Slack 2026-09-08 ("agents link to see and use the full admin inventory") · **Scouted:** 2026-09-08 (read-only, three agents) · **Ryan answered:** 2026-09-08 · **Tanner go:** 2026-09-19

## What Ryan described

A brokerage account holds the brokerage's inventory (e.g. 15 brokerage signs, plus lockboxes). Individual agents have their **own logins** and their own inventory (e.g. 2 name riders). Pink Posts admin tags each agent account as linked to one brokerage account. When the agent orders an install they pick **one brokerage sign from the brokerage pool** and **one rider from their own** — the system consumes each from wherever it came from. The whole brokerage pool must be visible to its agents; agents keep their personal inventory too. First brokerages: `Sienna@whitepicketky.com`, `Daphne@bhhsfoster.com`, `Realestaterigney@gmail.com`.

## What already exists (verified)

- `User.teamId` on both brokers and agents; `TeamMember.userId @unique` is the roster→login link (`prisma/schema.prisma:189-206`). **Nothing writes either for an agent today** (0 rows in prod — see `docs/sothebys-split-billing/design.md:11,15`).
- Inventory pickers read one endpoint, `GET /api/inventory` (`app/api/inventory/route.ts:77-93`): four queries, each `where: { userId: <one user> }`. The `?member_id=` branch (`:31-45`) already reads *broker rows filtered by an agent tag* — the closest precedent.
- `assignedToMemberId` on every inventory row = "reserved for this roster member"; never touched by ordering.
- Cart holds (`lib/inventory-holds.ts`, 15-min TTL, sweeper, atomic claim) — used only by the team_admin **cart/batch** path. Agents (role `customer`) use the **single-order** path, which has **no holds and no ownership check**: `app/api/orders/route.ts:601-643` flips `customer_*_id` rows by id alone. Same for edit (`[id]/edit/route.ts:683-701`) and hold creation (`api/inventory/holds/route.ts`, `inventory-holds.ts:800-808`). Today this is a latent IDOR hidden by discovery (agents never see foreign ids). A shared pool makes broker ids discoverable → **ownership enforcement is a build requirement, not a nice-to-have.**
- Removal never returns items to storage automatically; admin clicks "return to storage" on the **owning** customer's page (`admin/customers/[id]/inventory/route.ts:225-234`, `userId`-scoped). Because a row's `userId` never changes, a brokerage sign used by an agent lands back in the **brokerage's** storage — structurally correct, but the broker's "Currently Deployed" list can't say *which agent* has it out.

## Recommendation

**Reuse the team model; add a pool read + provenance + ownership predicate.** No new tables for the link. Ship in two phases.

### Phase A — the link, the pool, and safe ordering (≈3 days incl. review)

1. **Link an agent to a brokerage (admin only).** On the admin customer page of a *customer* account: a "Brokerage" selector listing `team_admin` accounts. Picking one: sets `user.teamId`, creates (or links) a `TeamMember` row with `userId = agent`, audit `AgentLinkedToBrokerage {from,to}`. "None" unlinks (teamId null, `TeamMember.userId` null; the roster row stays name-only). The three named brokerages get promoted to `team_admin` **without** the invoice-billing cascade (`admin/customers/[id]/route.ts:412-421` currently forces `invoiceBilling=true` on promotion — must become an explicit choice; these brokerages presumably pay by card).
2. **Pool read.** `GET /api/inventory` for a linked agent returns **own rows ∪ brokerage rows** (brokerage = `teamMember.team.adminUser`; rows `userId = broker`, `inStorage`, not held by someone else, and `assignedToMemberId IN (null, myMemberId)` — see Q1 for "whole pool"). Every item carries `source: 'own' | 'brokerage'` + `brokerageName`. Riders are aggregated **per source** (a broker "For Sale" rider and an agent "For Sale" rider must not collapse into one `{id, quantity}` bucket — the representative-id bug class at `rider-step.tsx:14-26`).
3. **Pickers show both pools** with a badge: "Brokerage — White Picket KY" vs "Mine". Sign step, lockbox step, RiderSelector; brochure boxes stay purchase-only for v1 (the wizard never sends `customer_brochure_box_id` today).
4. **Ownership predicate `allowedInventoryOwners(user)`** = `{user.id}` ∪ `{broker.id}` when linked (∪ team members' ids for a team_admin). Applied in: single-order create (validate every `customer_*_id` belongs to an allowed owner + `inStorage` before the flip), batch claim/fallback, edit restore/lock sets, `acquireHold`, `claimHoldsInTx`. Rejection = 409 `item_unavailable` (never leak the owner).
5. **Holds on the single-order path.** The pool is shared between agents, so the single-order route acquires holds for the chosen items inside the create transaction (same helper the batch route uses) — two agents can't consume the same brokerage sign.
6. **Order stamping.** Auto-set `placedForAgentName = teamMember.name` and `placedByUserId = agent` so the broker filter, invoice "Agent" column, dispatch "For agent" line and admin emails keep working.
7. **Admin visibility.** The agent's admin customer page gets a read-only "Brokerage pool (N available)" block; the brokerage's page "Currently Deployed" rows show *"out on <agent>'s order PPI-…"* (derived from the order item link, no new column).

### Phase B — broker-side (≈1–2 days, optional)

- Brokerage login sees its agents' orders/installations (extend the six team_admin ownership predicates with `{ user: { teamId } }` — same as the Sotheby's Phase 0 note).
- Brokerage can reserve pool items to specific agents (already exists as the assign dropdown; with Q1 = "whole pool" it becomes a soft preference).

## Schema

None required for Phase A. (Optional later: `OrderItem.consumedFromUserId` if Ryan wants provenance on historical orders without joining through the inventory row.)

## Copy that assumes "your inventory"

`dashboard/inventory/page.tsx:666,683`, `HowInventoryWorks`, `RiderSelector.tsx:103-109`, `sign-step.tsx:55-59`, `lockbox-step.tsx:103-125` — becomes "yours" vs "<Brokerage>'s" sections.

## Ryan's answers (2026-09-08) — LOCKED

1. **Whole pool.** "Whole pool for sure. That may be something we need to change if it becomes a problem but so far every admin has all their signs open." → the `assignedToMemberId` tag becomes a soft preference, NOT a filter. Pool read is every in-storage broker row regardless of tag.
2. **Agent pays.** "Agent pays (or whoever is processing the order under that admin, this should only be an inventory link, not a pay link)." → **the link must not touch billing at all.** No `invoiceBilling` inheritance, no payer re-resolution. Critically, the promote-to-`team_admin` path at `admin/customers/[id]/route.ts:412-421` currently forces `invoiceBilling=true`; that must become an explicit choice so linking a brokerage doesn't silently move it to invoice billing.
3. **Phase B is CUT.** "I'm going to go w no for now. When these are done, the admin actually wants to be fully hands off and not be the middle man… let's not over build bc the more we give them, the more they get confused with."
   → Do **not** build broker-side visibility of agent orders. Do **not** extend the six team_admin ownership predicates. Scope drops from ~4 days to ~3.
4. **Whole inventory in the pool.** "Signs, riders, and lockboxes. Riders we will def run into, I guess brochure boxes if they have them but that should be rare."
   → Brochure boxes ARE in the pool. This reverses the v1 "purchase-only" assumption: the wizard never sends `customer_brochure_box_id` today, so that field has to be plumbed through the order path as part of this build (create, batch, edit, ownership predicate). Small but real added scope.

## Revised scope (post-answers)

Phase A only, as described above, with these deltas:
- Pool read ignores `assignedToMemberId` entirely (answer 1).
- Brochure boxes join signs/riders/lockboxes everywhere (answer 4) — including a new `customer_brochure_box_id` on the wizard→API contract.
- No Phase B (answer 3).
- Linking is inventory-only and must be provably billing-neutral (answer 2) — the review must assert an agent's `invoiceBilling`, `flatFeeBilling` and payer resolution are untouched by linking.

## Risks

- The ownership predicate touches every inventory-consuming path — adversarial review mandatory; the review must include the Semonin/Redfin team_admin cart path to prove no regression for name-only rosters.
- Rider aggregation change is the likeliest place to reintroduce the duplicate-rider bug (2026-07-28 incident) — regression fixture.
