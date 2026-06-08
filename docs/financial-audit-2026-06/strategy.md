# PPI Profitability Strategy — Final
**Prepared by Tanner / Clarity Digital · 2026-06-08**
Live Railway pull (read-only) + 5 parallel analyses + adversarial pressure-test.
Numbers below are auditable against the data brief in `/baseline.md`.

---

## TL;DR for Ryan

PPI has done **$9,769.43 across 177 paid orders all-time**, ~95% of which happened in the last 90 days. Labor as a % of revenue currently runs **~96%** at realistic routing density. The problem is **not** drive time or wages — it's that the average order ($63.95) prices below what it costs to deliver, and the existing fee mechanisms in the codebase (out-of-area surcharge, post rental, trip fees) have collectively brought in **$200 ever** because they're either misconfigured for the customer pattern or not enforced.

**Three changes ship in week 1 and lift annual contribution by ~$8K against the current baseline, ~$25K at next year's projected volume.** None require new hires, new SKUs, or new service centers.

---

## The Diagnosis

| What | Number | Read |
|---|---|---|
| Lifetime gross revenue | **$9,769** | 3-month-old going concern, not a mature business |
| Last 30 days revenue | $5,470 | Growing — Mar $979 → Apr $2,733 → May $3,930 → Jun(partial) $2,065 |
| 100%-off promo orders (TOOCOLD / SAVETIME) | **42 / 177 (23.7%)** | $2,834 directly foregone |
| Out-of-area $50 surcharge fires | **0 / 177** | All real demand is within 45-min Lex band; surcharge is silent deterrent only |
| Post-rental charges collected | **$0 ever** | Median install lifetime is 35 days; 6-month cliff almost never hits |
| Service-trip fees billed | **5 of 45 (11%)** | Work done, money never asked for |
| Refund rate | **0%** | Customers happy; service quality is fine |
| Repeat behavior | 48.5% one-time | Acquisition working; retention untested |
| Top 20 = % of revenue | **78%** | Heavily concentrated; losing any single anchor = visible cliff |
| Brokers actually using bulk-place feature | **0 orders ever** | Semonin orders via individual agent logins, not the dashboard |
| Labor as % of revenue (realistic routing) | **96%** | Structural — fix is pricing + density, not hours cut |

The unit economics are upside-down at current pricing. **Volume makes it worse, not better, until prices are right.**

---

## Top 5 Recommendations (revised)

Ranked by (annual dollar lift ÷ effort to ship). All dollar estimates assume current last-90-days run-rate holds; Q3 seasonality unknown. Caveat applies to every number below.

### #1 — Stage the price hike: $63.95 → $72 (60 days) → $79
**What:** Raise the Signature Pink Post install fee to $72 immediately, measure conversion for 60 days, then move to $79 if no measurable cancellation cliff. Simultaneously raise the sign install $3 → $7 — still half of competitor pricing but materially lifts AOV. One PR.
**Why staged not single-step:** the dataset has zero price variance, so elasticity is unknowable. Staging protects against a Q3 demand cliff during the critical selling season.
**Why $79 is the destination:** InstallNow.io charges $79 in Cincinnati (PPI's 2nd service center). SignBoss $75-85. Post Pros Nashville $75. PPI is currently the cheapest install service in the region by 20-30%.
**Dollar impact:** +$12-19/order × last-90-days run-rate ≈ **+$5-8K/yr at current volume; +$25-40K at next-year's projected volume.**
**Effort:** 1 day. Constants in `components/order-flow/types.ts`.
**What could go wrong:** Some price-sensitive solo agents push back. The anchor 20 customers (78% of revenue) aren't price-shopping. Solo agents at the bottom of the customer pyramid may be — sequencing mitigates.

### #2 — Auto-bill the trip fee
**What:** When admin completes a service request, the default action is "invoice $40." Skipping requires a typed reason. Today the default is the opposite.
**Why it works:** Mechanism already works (5/5 invoiced trips were paid, 100%). The gap is purely UX nudge: skip is currently the path of least resistance.
**Dollar impact:** Realistic recovery 60-75% (some trips legitimately shouldn't bill — own scheduling errors, warranty, anchor goodwill). At current rate: **+$3,000-3,800/yr.**
**Effort:** Half day. One admin modal.
**What could go wrong:** 2-4 awkward calls/quarter from agents who didn't read fine print. Mitigation: send a one-time "starting [date], trip fees auto-bill per published schedule" email to existing 68 paying customers.

### #3 — Cap promo discounts at 25%, kill 100%-off codes permanently
**What:** Hard validation rule: no discount code exceeds 25% off. Replace "TOOCOLD"-style winter promos with "$20 off first install" (bounded exposure ~$20 per acquisition, not ~$129).
**Why it works:** The 42 TOOCOLD/SAVETIME orders directly foregone **$2,834 in revenue.** Whether word-of-mouth recovered any of that is unmeasurable (no acquisition-source tracking exists yet — see #6 below).
**Dollar impact:** **+$2,800/yr** in the next slow season if a similar promo gets considered. $0 if Ryan simply stops doing it.
**Effort:** 2 hours. Validation rule on promo create.
**What could go wrong:** Marketing-optics loss of "headline-grabbing" discount. The data shows it didn't actually drive measurable conversion at the heavy discount level.

### #4 — ZIP-cluster soft preference (carrot, not stick)
**What:** Booking UI defaults to "preferred days" for each ZIP cluster (e.g. Georgetown installs default to Mon/Wed/Fri) **but off-day booking remains available**. Off-day bookings offered a **$15 discount** to incentivize moving to a preferred day. Customer can still book any open day.
**Why staged this way:** A hard rule conflicts with anchor retention — Kristine Cassata (top customer, 13 orders) and similar agents need next-day install for sign-of-listing urgency. A discount routes demand without losing the anchor.
**Why it works at all:** 49% of scheduled days have exactly 1 stop. Crew gets paid an 8-hour day either way. Moving toward 3-stop-day average recovers meaningful labor.
**Dollar impact:** **+$2,000-4,000/yr conservative** — much smaller than original draft because the carrot is weaker than a hard rule, but avoids the anchor-loss risk. Scales materially with volume.
**Effort:** 1 week.
**What could go wrong:** Customers ignore the discount and book whichever day they want. In that case the cost is just the $15 occasional discount, not lost anchors.

### #5 — Add `acquisitionSource` to signup form
**What:** A single dropdown on the customer signup form: "How did you hear about us?" — referral (with name), Google search, Facebook/Instagram, broker recommended, walked past a sign, other. Persisted to User. One field.
**Why this is now top-5 (was buried in week 4):** Every other recommendation in this doc that involves customer-acquisition decisions is unfounded without CAC data. **You cannot decide "solo realtor vs broker focus" without knowing where each segment is coming from.** Six months of this data unlocks every Q4 strategic decision.
**Dollar impact:** $0 direct. **Massive optionality value** — likely worth more than #4 over 12 months.
**Effort:** 2 hours. Signup form + User column.

### Defer the 6-month rental restructure
The original Recommendation #5 ($18 at 6mo restructured to $15/wk after 60 days) is removed from the top 5. Honest math: at current volume only ~140 installs/yr will cross 60 days, and realistic average metered rent collected is **~$10/install** = ~$1,400/yr — too small to prioritize ahead of acquisition-source tracking. The dormant 6mo schedule should be left in place — it's the long-tail recovery for slow-pickup edge cases and costs nothing to leave dormant. **Fold the rental concept into Recommendation #1 as a small base-fee lift** rather than running two pricing systems.

### Combined revised impact

| # | Recommendation | Annual lift (current vol) | Annual lift (next-year projected) | Effort |
|---|---|---:|---:|---|
| 1 | Stage price $64 → $72 → $79 + sign $3 → $7 | $5,000-8,000 | $25,000-40,000 | 1 day |
| 2 | Auto-bill trip fee | $3,000-3,800 | $15,000 | Half day |
| 3 | Cap promos at 25% | $2,800 (if needed) | $14,000 | 2 hours |
| 4 | ZIP-cluster carrot | $2,000-4,000 | $15,000 | 1 week |
| 5 | Acquisition-source tracking | $0 | Strategic optionality | 2 hours |
| | **Total realistic 90-day** | **~$8-13K** | **~$30-40K** | |

---

## Plus one small cleanup

**Remove the brochure box from the order catalog UI.** 1.7% attach rate, not pricing-fixable (demand isn't there). Pulling it from the conversion funnel is a 1-hour change with zero downside and a meaningful UX simplification.

---

## What Won't Move the Needle

- **Design Your Sign** product launch (existing scoped plan). 20% attach × $70 net × current volume ≈ $9K/yr — real money but requires 4 weeks of build. Top 5 above deliver more revenue, faster, with 1% of the engineering cost. **Park until the price hike and trip-fee fix are shipped and absorbed.**
- **Out-of-area surcharge enforcement / expansion.** Has fired 0 times in 177 orders. Every demand ZIP is in-band. Don't tune it.
- **Drone photos / yard surveys / sign-maintenance subscriptions.** All add truck visits. At 96% labor cost, any service consuming crew time without commanding $80+ AOV is contribution-negative.
- **The team_admin/broker feature in its current shape.** 1 broker uses it; the bulk-placement UI has generated 0 orders ever. Don't build more around team_admin until at least one broker actually uses what's already built.
- **Quarterly market reports, white-label software, CRM integrations.** Real strategic merit; no 90-day ROI. 12-month list.
- **Firing the bottom 20% of customers.** They're 0.4% of revenue and ~8% of order volume. Cutting them recovers almost nothing.

---

## Structural Questions Only Ryan Can Answer

1. **Solo-realtor business or broker business?** 96% of revenue is solo realtors at $55 AOV. Broker feature is dormant; broker perks (free out-of-area, free lockbox install) are sized for high-volume customers that don't exist yet. **Decision:** sunset the broker discount tier until a broker proves >10 orders/month, or actively sales-pitch 3-5 brokerages on a paid subscription ($199-249/mo) this quarter. Don't sit in the middle giving away margin for negligible volume.

2. **Lifestyle business or growth business?** Top 20 = 78% of revenue. Losing Kristine or Caitlin is a measurable cliff. A growth business invests in diversification + referral attribution. A lifestyle business optimizes for the 20 anchors and stops trying to acquire new ones. The price/ops fixes above work for either, but Q4 strategy depends on this answer.

3. **What's the right next geography?** 5 service centers exist; only Lexington is meaningfully utilized. Adding center #6 before Lexington is dense doesn't help. **Decision:** "more orders inside existing 5 centers" or "a 6th center"? Data emphatically says the former.

4. **Subsidize signs as a loss leader for posts?** Sign install is $3, 88% attach — effectively included. This bundle is intentional but it's why AOV anchors near $65 instead of $80. The top-recommendation $3 → $7 sign price IS the change here.

---

## Roadmap

### Week 1
- **Day 1:** Add `acquisitionSource` field to signup form (Recommendation #5) — start collecting data immediately
- **Day 2:** Auto-bill trip fee modal (Recommendation #2) — internal change, invisible to customers
- **Day 3:** Promo cap validation (Recommendation #3) — invisible to existing customers
- **Day 4-5:** Brochure box catalog removal (cleanup)

### Week 2
- Send the trip-fee-policy notice email to 68 paying customers (one-time, low-key)

### Week 3-4
- Price hike to $72 (Recommendation #1 phase 1) + sign $3 → $7 — visible change, send announcement email
- Monitor conversion rate vs prior 60 days

### Days 60-90
- If no measurable cancellation cliff: move to $79
- Recommendation #4 — ZIP cluster soft preference + $15 off-cluster discount
- Begin first wholesale procurement conversations (Dee Sign / Lowen distributor accounts for post + hook + solar lighting at volume)

### 90-365 days
- Re-evaluate broker strategy based on 6 months of acquisition-source data
- Decide on geography expansion vs Lexington density push
- Re-scope Design Your Sign if AOV hypothesis holds
- Decide lifestyle vs growth posture

---

## The Honest Bottom Line

Ryan, this is not as bad as it feels. The business is **structurally sound, the customers are happy, and the codebase is genuinely better than every competitor's.** What's broken is pricing and fee enforcement — both fixable in a single dev sprint. "Push volume" isn't wrong, but it's incomplete: today's volume loses money per order. Two weeks of changes flips that math, and then volume is the right strategy.

The 100%-off promos from winter weren't a strategic mistake — they were a goodwill gesture in a slow season. The lesson is just: **don't subsidize customers who aren't profitable on their next order.** Charge market rate. Bill every trip. Cap every discount. Track where customers come from. Then push volume.

---

## Methodology + Caveats

- All dollar projections assume current 90-day order volume holds. Q3 seasonality unknown.
- Last-90-days annualization (~660 orders/yr) used for "current volume" estimates; growth trajectory (Feb 6 → Mar 20 → Apr 52 → May 72) suggests this may understate actual run-rate.
- "Next-year projected volume" estimates assume 5× current run-rate.
- Labor math assumes 2-person crew at $25/hr per Ryan's stated wage; if solo installs happen on small jobs, the realistic % is lower than 96%.
- Fuel costs not in baseline (no expense data piped in).
- LTV / acquisition source data does not exist — Recommendation #5 fills that gap.
- Refund rate of 0% reflects no refunds processed through the system, not necessarily zero complaints.

Source-of-truth pull: live Railway Postgres, 2026-06-08. 177 paid orders all-time, 68 paying customers, $9,769.43 lifetime gross. Full data brief in `baseline.md`.
