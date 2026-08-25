# Sotheby's split billing — design (PLAN ONLY, not being built yet)

**Status:** design for Ryan's feedback · **Requested:** Ryan, Slack 2026-08-25 ("plant the seed … don't need to build just yet") · **Spec'd:** 2026-08-25 (explore → design → adversarial critique; critique verdict *needs_changes* — every must-fix is folded into §9 as a build requirement)

## What Ryan described

Lenihan Sotheby's: one broker admin who sees every agent's orders/inventory; agents have their own logins, own inventory, and place their own orders. On each agent order the broker is invoiced a fixed **$64 subtotal + $3.49 gas + 6% tax = $71.33** ("just like the Semonin accounts"); anything beyond that is charged to the **agent's card on file** — e.g. post + rider + solar light → $71.33 to the invoice, the solar light to the card.

## Recommendation in one paragraph

**One Order with a two-leg ledger, shipped in two phases.** The broker leg is literally `computeFlatFeePricing(3.49, 64)` — the existing Semonin helper already returns `{64, 3.49, 3.84, 71.33}` (`lib/orders/pricing.ts:51-57`), so the broker side needs no new math. The agent leg is "everything taxable above $64 + 6% on it + any out-of-area fee", computed as an **integer-cent residual** of the à-la-carte total (see §3). The order's `paymentStatus` stays `pending_invoice` so every invoice-side consumer (both bundlers, invoice-paid webhook, cancel-unpaid path) treats it as a broker-invoice order with zero changes; the agent's card charge lives in dedicated columns cloned from the out-of-area second-charge pattern (`schema.prisma:433-437`; `lib/orders/out-of-area-charge.ts`) so it can never collide with `order.paymentIntentId`. **Phase 0** makes agent logins real with no money change (agents pay their own card) — the "agent with a login on a team" model has never run in production (0 `TeamMember.userId` rows, 0 orders with `placedByUserId`). **Phase 1** adds the split. Because the broker leg is invariant for the life of the order, edits never touch the broker invoice — only the agent's card moves.

## 1. Account model ("tagging" an agent)

Schema already anticipates this: `User.teamId` shared by team_admin + agents; `TeamMember.userId @unique` is the roster→login link (`schema:189-202`); `canActOnBehalfOf` = same `teamId` (`lib/auth-utils.ts:57-73`). What's missing is a **write path** — nothing ever sets `TeamMember.userId`.

Setup (Pink Posts admin, from the team section of the admin customer page `app/admin/customers/[id]/page.tsx:622-670`):
1. Broker user: `team_admin`, `invoiceBilling=true`, `isServiceAreaExempt` per Ryan, team "Lenihan Sotheby's" — identical to Semonin.
2. **New** per-team `Team.brokerAllowanceCents` (6400; null = no split). Admin toggle follows the Round 22 pattern (`docs/round22/design.md:337-350`) with `{from,to}` audit.
3. **New** per-roster-member "Create login" / "Link existing customer" → sets `TeamMember.userId`; password via the existing reset-token flow (admin never sets it). Audit `TeamMemberLoginLinked`.
4. "Tagged as Sotheby's" ≡ `user.teamId = <team>` AND `teamMember.userId = user.id`.

Agents stay role `customer` → normal dashboard; no cart (`cartEnabled` requires team_admin/onBehalfOf, `review-step.tsx:49`), so every agent order goes through the single-order route — the batch route is out of scope by construction. Inventory: keep the physical model (items held under the broker with `assignedToMemberId`); add one `/api/inventory` branch: caller with a linked `teamMember` → `targetUserId = broker`, `memberFilter = { assignedToMemberId: member.id }` (clone of `inventory/route.ts:31-45`).

**Broker sees everything** (Phase 0, no schema): the critique's better answer — extend the six team_admin ownership predicates with `{ user: { teamId: me.teamId, role: 'customer' } }` (team membership is already defined this way in `canActOnBehalfOf`). Covers orders placed before any stamping starts. Keep `Order.invoiceAccountUserId` for **billing identity only** (which team_admin's invoice the order belongs to). Auto-set `placedForAgentName = teamMember.name` at create so the agent filter, invoice "Agent" column, and admin emails keep working.

## 2. Pricing rule (server-authoritative)

Deterministic 6% (Stripe Tax skipped for split accounts, exactly as flat-fee does — `docs/round22/design.md:333`).

- `alacarte = computeOrderPricing(items, …)` — price ONCE, as a normal customer would pay. This is the recorded order: `order.total`, `tax`, etc. are the true à-la-carte numbers.
- **Broker leg** (always): `computeFlatFeePricing(fuel, allowance/100)` = **$71.33**, frozen (`splitAllowanceCents` on the row, same idea as `baseOverride`).
- **Agent leg** = `recordedCents − 7133` as an **integer-cent residual** — never a separate tax computation. The critique verified that "3.84 + round(0.06 × (T−64))" drifts by a cent from the à-la-carte total for 134 of 23,600 values in $64–$300 (e.g. T=66.25); the residual method makes `broker + agent === recorded` an identity **and** makes the agent pay exactly what a normal customer would have paid above the allowance.
- **Floor rule (Q1):** when à-la-carte taxable < $64, the broker still pays $71.33 and the agent $0; `recorded.total` is clamped to $71.33 (flat-style clamp, `orders/route.ts:390-403`). The alternative "cap" reading (broker pays `min(items,$64)`) is a 5-line change in the same helper — **Ryan must pick.**
- Out-of-area: exemption resolved against the **broker** (billing account) for split teams if Ryan wants agents to inherit it (Q5); otherwise the fee is the agent's and the existing half-now/half-at-removal path already lands on the agent (`out-of-area-charge.ts:43-46` resolves `placedByUserId ?? userId` = agent).
- Promo codes: **disabled** for split accounts (with a floor, a discount can only shrink the agent's overage to $0, then silently subsidizes nobody).

Worked examples (fuel $3.49, 6%):

| Order | à-la-carte | Broker invoice | Agent card | Recorded |
|---|---|---|---|---|
| Vinyl $59 + rider $5 | $71.33 | **$71.33** | **$0** (no card needed) | $71.33 |
| + solar light $5 | $76.63 | $71.33 | **$5.30** | $76.63 |
| Signature Pink $65 + rider | $77.69 | $71.33 | $6.36 | $77.69 |
| Wood panel $95 + rider | $109.49 | $71.33 | **$38.16** | $109.49 |
| + lockbox rental $10 | $81.93 | $71.33 | $10.60 | $81.93 |
| + expedite $50 | $124.33 | $71.33 | $53.00 | $124.33 |
| out-of-area, not exempt | $96.33 | $71.33 | $25 now + $25 at removal | $96.33 |
| post-only $59 (floor) | $66.03 | $71.33 | $0 | $71.33 |
| no post: sign $3 + rider $5 + $40 fee (floor) | $54.37 | $71.33 | $0 | $71.33 |

New helper `computeSplitPricing({ alacarte, allowanceCents, fuel })` in `lib/orders/pricing.ts`; unit-tested in integer cents against this table **and** against `computeOrderPricing(...).total` (not just against its own sum), including quarter-cent boundaries (66.25, 68.75, 74.75) and an OOA half-fee case.

## 3. Checkout — server (`app/api/orders/route.ts`)

`billingContext.mode = 'split'` iff actor is `customer` with `teamId`, `team.brokerAllowanceCents > 0`, and the team's broker has `invoiceBilling`. Then: price → split → require `payment_method_id` iff `agentPortionCents > 0` → **authorize the agent PI first with `captureMethod: 'manual'`** (`lib/stripe/server.ts:96-104` already supports it) → create the Order (`paymentStatus 'pending_invoice'`, `paymentIntentId null`, `invoiceAccountUserId`, `placedForAgentName`, split columns, `agentChargeStatus processing|not_required`) → capture → on tx failure cancel the PI. (Critique: this keeps today's "decline → 400, no order" UX with none of the create-then-cancel ghost orders the first draft had.) PI metadata `{ kind: 'split_agent_portion', orderId, brokerUserId }`, idempotency `split-agent:<orderId>`.

**The create response and the complete-payment route must speak the AGENT PI's status**, never the order's `paymentStatus` (which is a constant `pending_invoice` for split orders) — otherwise 3DS never triggers client-side and the resume route would corrupt the broker leg (critique must-fix).

## 4. Checkout — what the agent sees
```
Order total                         $76.63
  Billed to Lenihan Sotheby's       $71.33   (post + rider allowance $64.00, gas $3.49, tax $3.84)
  Charged to your card              $5.30    (Solar light $5.00 + tax $0.30)
[ Place Order — $5.30 on Visa ••••4242 ]   or   [ Place Order — nothing due today ]
```
Card picker shown only when agent portion > 0; promo box hidden (flat-fee pattern). The service-area **quote** endpoint must apply the same broker-resolution rule as create (it resolves exemption against the session user today, `service-area/quote/route.ts:60-66`) or the review step shows a fee the server won't charge.

## 5. No card / declined card
- Agent portion $0: order proceeds with no card, `agentChargeStatus not_required` (recommended, Q4). Consequence: later edits / OOA pickup charges with no card fall into the existing `no_payment_method` worklist.
- Agent portion > 0 with no card: blocked on the review step + 400 server-side.
- Sync decline: no order (authorize-first). Async 3DS abandon: dashboard "Complete Payment" banner reads `agentPaymentIntentId`; async failure → webhook marks `failed`, order stands, admin Retry.

## 6. The broker invoice
Both bundlers already select `pending_invoice` + `invoiceId null`; ownership predicates gain `invoiceAccountUserId`. **What is summed** changes: `lib/invoices/billable-portion.ts` → `billableLeg(order)` = `{ subtotal 64, fuel, tax 3.84, expedite 0, noPost 0, discount 0, total 71.33 }` for split orders (must neutralize **every** money column the readers sum — critique found expedite/noPost/discount leaking into the PDF footer), else the order's own columns. Used in **one commit** across: bundle totals, admin preview + POST, `load-detail.ts`, invoice GET, `invoice-pdf.ts`, dashboard invoice page. PDF row: `Broker allowance — post + rider … $64.00` + `(agent paid $5.30 by card for add-ons)`. A Sotheby's invoice is always **N × $71.33** — trivially auditable, which is what Ryan wants. Because split orders skip the money-column freeze, **any reader not going through `billableLeg` silently rewrites a sent invoice** — the one-commit rule is load-bearing.

## 7. Edits
Split branch ahead of the existing ladder (today `pending_invoice` short-circuits to `invoice_billing_skip`, which would roll agent overage onto the broker): recompute à-la-carte with frozen fuel, no promo → `agentDiff` drives the existing card-charge ladder against the **agent's** card; broker leg unchanged by construction; no post-invoice adjustment ever. Copy sites that infer "nothing charged" from `pending_invoice` (edit emails `edit/route.ts:1103,1171,1197`; cancel modal `willRefund`) need a split branch or they'll tell the agent no refund is coming.

## 8. Cancellations and refunds
- Not yet invoiced: `cancelUnpaidOrder` drops the broker line; add `refundSplitAgentLeg` (full refund of `agentPaymentIntentId`, distinct idempotency suffix).
- Invoiced but unpaid: **manual in v1** (void/re-issue). The first draft promised a −$71.33 Adjustment line, but both bundlers' sweeps explicitly exclude cancelled orders (`bundle/route.ts:170`, `admin/invoices/route.ts:301`) — the credit would never sweep. Don't promise it.
- Invoice paid: `refundOrder` must be **refused** for any order with `invoiceId != null` — today it would refund the entire invoice PI (`lib/refunds.ts:143-147`). Pre-existing hazard for every invoiced order; must land before split ships.
- Refund-email recipient: `resolveRefundRecipient` prefers the team_admin for agents on a team — an agent-leg refund email would go to the broker. Pass the agent explicitly.

## 9. Build requirements from the critique (all verified in code)
1. **Order-completion auto-charge** (`app/api/orders/[id]/route.ts:110-192`) gates on `order.user.invoiceBilling` (the agent) and `paymentStatus !== 'succeeded'` — it would charge the agent the **full** order total when admin marks the install complete, days before the monthly invoice, then flip the order to `succeeded` so it leaves the bundler. Must gate on `isInvoiceAccountOrder()`.
2. Tax as an integer-cent residual (§2), tested against `computeOrderPricing`, not against its own sum.
3. Create response + `complete-payment` GET/POST must read/write the agent PI status (§3).
4. Post-invoice cancellation credit is manual in v1 (§8).
5. **Post-rental billing would reach the broker's card**: the cron's Pass-1 filter is `user.invoiceBilling: false` (agent passes), eligibility exempts only owner team_admin/invoiceBilling, and `resolveBillingPayer` falls through to the agent's team_admin's saved card when the agent has none (`cron/post-rental-billing/route.ts:139, 547-560`). Regardless of Q9, the broker card must be unreachable: set `postRentalDisabled` at create or exempt via `isInvoiceAccountOrder()` in both eligibility and Pass-1.
6. `billableLeg` neutralizes every money column (§6).
7. Service-area quote endpoint uses broker-resolution for split teams (§4).
8. `isInvoiceAccountOrder()` replaces all six owner-flag guards: order completion, admin charge (`charge/route.ts:52`), SR invoice (`sr invoice:61`), post-rental eligibility + Pass-1/Pass-2, edit-email copy.
9. `charge.refunded` webhook: add a `metadata.kind === 'split_agent_portion'` lookup by `orderId` so a dashboard refund of the agent PI flips `agentChargeStatus`.
10. Server-side catalog price check for split teams — item totals are client-trusted today; with two payers, a devtools edit moves money between parties.

## 10. Schema (additive, nullable, no backfill)
`Team.brokerAllowanceCents Int?` · `Order.invoiceAccountUserId String?` (+index, relation) · `Order.splitAllowanceCents / brokerPortionCents / agentPortionCents Int?` · `Order.agentPaymentIntentId String?`, `agentChargeStatus SplitChargeStatus?` (+index), `agentChargedAt`, `agentChargeError` · `enum SplitChargeStatus { not_required, processing, paid, failed, refunded }` · first-ever writes to `TeamMember.userId`.

## 11. Phasing and effort
- **Phase 0** (~2–3 days): create/link-login endpoint + admin UI; `/api/inventory` linked-member branch; perks via `/api/profile`; auto `placedForAgentName`; team-based broker visibility predicates; seed fixture. Reversible, no money change. Recommended to run with Sotheby's for a week or two on their own cards first.
- **Phase 1** (~6–8 days incl. adversarial review + Railway QA on a seeded test team with Stripe test cards): allowance toggle, schema, `computeSplitPricing`, create-route split mode, review-step settlement, webhook branches, `billableLeg` across readers (one commit, byte-identical Semonin PDF check), edit branch, cancel/refund branch, admin "Billing split" card + retry, emails, post-rental rule, `refundOrder` invoice guard, order-completion guard.
- Total ≈ 9–11 dev days / ~2.5 calendar weeks, **gated on Q1–Q5**.

## 12. Decided defaults (Ryan can override)
Everything taxable above $64 + any OOA fee is the agent's; gas always the broker's · agent add-ons are taxed ($5 solar = $5.30 — KY 6% must be collected) · no card required when the agent portion is $0; a declined card blocks the order · promos off · edits charge/credit the agent only · broker sees full totals + "your share $71.33 / agent paid $X"; no broker CC on agent confirmations (card details privacy) · Pink Posts creates agent logins · allowance is a per-team setting, future-only when changed · admin bundles monthly like Semonin · Phase 0 first.

## 13. Questions only Ryan can answer
1. **Floor or cap?** Agent orders less than $64 of taxable items (post-only $59, metal frame $50): is Sotheby's still billed $71.33 (floor — recommended, every invoice = N × $71.33) or only what was ordered + gas + tax?
2. **Out-of-area & lockbox perks:** same as Semonin (no OOA fee, free owned-lockbox install) for the whole team? If not, the OOA fee is the agent's card.
3. **Post-rental (6/9-month) charges** on these orders: agent's card, Sotheby's invoice, or none (like Semonin)?
4. **Service trips** (repairs, removals, re-installs) on a Sotheby's property: agent's card ("beyond the initial") or Sotheby's invoice?
5. **Broker edits an agent's order** and it costs more — charge the agent's card (that's what the code would do today) or block the broker from money-changing edits?
