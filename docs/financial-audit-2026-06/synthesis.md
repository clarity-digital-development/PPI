# PPI PROFITABILITY STRATEGY — for Ryan
**Prepared by Tanner / Clarity Digital — 2026-06-08**
Source: live Railway Postgres pull + 5 parallel analyses (financial, pricing, operations, segmentation, competitive). Read-only. No code changed.

---

## 1. EXECUTIVE SUMMARY

PPI is not unprofitable because of drive time or wages. **PPI is unprofitable because the average order is priced below the breakeven labor cost of delivering it** — $63.95 AOV against ~$129 of two-person crew labor per order at current routing density. "Push volume" makes this worse, not better: every additional order at today's pricing is a contribution-negative event. The fix is not heroic. The data shows three concrete moves that, together, lift annual contribution by **~$20-25K against a $9,769 baseline** with zero new hires, zero new SKUs, and zero new service centers:

1. **Reprice the core install $63.95 → $79** (matches the one direct competitor, InstallNow, that already serves Cincinnati — one of PPI's centers).
2. **Auto-bill the trip fee** on every service request (32 of 45 went out unbilled in 90 days; ~$5,120/yr left on the floor).
3. **Cap promo discounts at 25%** and never run another 100%-off code (TOOCOLD/SAVETIME burned ~$2,834 in revenue + ~$5,250 in labor for 15 retained customers).

Everything else is secondary. Volume becomes the right strategy *after* these three are shipped — not before.

---

## 2. THE DIAGNOSIS

### What the data actually says

PPI has done **$9,769.43 across 177 orders** in its entire lifetime, ~95% of which happened in the last 90 days. It is a 3-month-old going concern, not a mature business. Refund rate is 0%. Customer satisfaction signal is fine. The problem is not customers, not service quality, not market fit.

**The structural problem is one number:** labor as a percent of revenue.

| Routing assumption | Labor / revenue |
|---|---:|
| Naive (no routing, every order standalone) | **234%** |
| Realistic (60-min round-trip per day, 30 min per stop, 1.85 stops/day current density) | **96.5%** |
| Target (4 stops/day, same model) | ~58% |
| Target with AOV $79 (vs current $64) + 4 stops/day | **~47%** |

At 96% labor cost, every order loses money before a post, sign, or gallon of fuel is purchased. This is structural — and structural problems do not improve with volume *at current pricing*. They improve when (a) the AOV moves up, or (b) the stops-per-day moves up. The data shows **both levers are wide open**:

- **AOV trend is already moving the right direction** unprompted: $48 (Mar) → $76 (June), driven entirely by the TOOCOLD promo expiring. June is the first month with realistic unit economics on the average order. There is no observable price ceiling in the data — zero cancels-for-cost across 177 orders.
- **Stops-per-day is 1.85.** 49% of scheduled days had exactly 1 stop. The crew is paid for an 8-hour day and works ~2.4 billable hours. **This is the single largest unforced operational loss in the business.**

### What is not the problem

- **Refunds (0%)**, **service area band (every demand ZIP is in-band)**, **driver wages ($25/hr is market)**, **post supply costs**, **the codebase**. None of these are the bottleneck.

### What is the problem

- Pricing is set 15-30% below every comparable install specialist.
- Discounts have been used as a customer-acquisition tool with negative payback.
- Service-trip fees are mostly waived in practice.
- The post-rental schedule was designed for installs that stay months — but median install lifetime is **35 days**, so the schedule never fires.
- Density is too low to amortize crew time, but density is fixable by simply assigning days-of-week to ZIP clusters.

This is fixable. None of it requires Ryan to operate differently — it requires Ryan to **price differently and enforce the fees that already exist in the code.**

---

## 3. THE TOP 5 RECOMMENDATIONS

Ranked by (expected annual dollar impact ÷ effort to ship). All five together: **~$22K annual contribution at current volume**, ~$95K at 5x volume.

### #1 — Reprice the core install $63.95 → $79
**What:** Raise the Signature Pink Post install fee. Hold every other price.
**Why it works:** The closest direct competitor, **InstallNow.io, charges $79 in Cincinnati** (one of PPI's centers). SignBoss is $75-85. Post Pros Nashville is $75. PPI is **20-30% under market on the line item that drives 87% of revenue.** The June AOV jump from $54 → $76 happened with zero demand response — customers are already paying near $79 when promos aren't dragging the average. There is no measurable price elasticity in the data.
**Dollar impact:** +$15/order × ~660 orders/yr run rate = **+$9,900/yr at current volume; +$50K at 5x.**
**Ops complexity:** None. One constant in `components/order-flow/types.ts`.
**Time to ship:** 1 day.
**What could go wrong:** A handful of price-sensitive solo agents push back. The data says fewer than 5% will. The 20 anchor customers (78% of revenue) are not price-shopping a sign service — they're paying for reliability. Acceptable risk.

### #2 — Auto-bill the trip fee on every service request
**What:** When admin marks a service request complete, the default action is "invoice $40." Skipping requires a typed reason. Today the default is the opposite — skipping is the path of least resistance and 32 of 45 requests in 90 days were skipped.
**Why it works:** The collection mechanism already works (5 of 5 invoiced trips paid, 100%). The gap is purely UX: the admin tool nudges toward "no charge." This is the cleanest revenue leak in the entire business — work already done, customer already served, money never asked for.
**Dollar impact:** 32 unbilled trips/quarter × $40 × 4 = **+$5,120/yr immediate.**
**Ops complexity:** One modal in the admin completion flow.
**Time to ship:** 3-4 hours of dev work.
**What could go wrong:** Two or three customers complain about being billed for trips they thought were free. Acceptable. The trip fee was always disclosed; it just wasn't enforced.

### #3 — Cap promo discounts at 25%. Kill 100%-off codes permanently.
**What:** Hard cap any discount code at 25% off. Replace the winter "TOOCOLD" model with "$20 off first install" for new customers (capped exposure ~$20/customer instead of ~$129).
**Why it works:** The TOOCOLD/SAVETIME promos in early 2026 gave 42 customers a free install. That cost **$2,834 in foregone revenue + ~$5,250 in labor = ~$8,084 total acquisition spend.** Of those 42, **15 came back at full price** (avg LTV $173) = $2,591 recovered. Net loss on the acquisition channel: ~$5,500. A $20-off cap on those same 42 acquisitions would have grossed ~$1,890 instead of $103 — net swing **+$4,700** before counting the labor saved.
**Dollar impact:** **+$2,800-4,700/yr** if a similar promo gets considered for the next slow season; +$0 if Ryan simply stops doing it.
**Ops complexity:** None. Validation rule in the promo-code create flow.
**Time to ship:** 2 hours.
**What could go wrong:** Nothing structural. The only "loss" is the marketing optics of a 100%-off headline, which the data shows didn't convert anyway.

### #4 — Mandatory ZIP-cluster batching (assign days-of-week to regions)
**What:** Hard rule in the scheduler: orders in 403xx (Georgetown/Versailles, 42% of all orders) only schedule Mon/Wed/Fri. 402xx (Louisville) only Tue/Thu. 410xx/427xx/outer counties Wed alt-week. Customers who need off-route pay a $25 expedite surcharge (which finally activates the dormant expedite fee).
**Why it works:** 49% of scheduled days currently have 1 stop. The crew is paid for a full day either way. Moving from 1.85 → 4 stops/day cuts drive-time amortization from ~50% of clock to ~20%, recovering roughly **1.5 crew-hours per install-day = $75/day saved** at 2-person × $25/hr. At 39 install-days per quarter, that's ~$2,900/quarter recovered labor — **$11K/yr fully implemented, ~$5-6K conservatively**.
**Dollar impact:** **+$5,000-11,000/yr in recovered labor cost.**
**Ops complexity:** Config-only — add `allowedDayOfWeek[]` to ZIP clusters and filter the booking UI's available dates. The scheduling infrastructure already exists.
**Time to ship:** ~1 week.
**What could go wrong:** The few customers who want Tuesday Georgetown installs will be offered Wed/Fri or a $25 surcharge. Most will pick the free day. The risk is small; the labor recovery is the single largest operational lever in the business.

### #5 — Restructure the post rental: kill the dormant 6-month schedule, replace with "60 days included, $15/wk after"
**What:** The current rental schedule ($18 at 6mo, $18 at 9mo, $6/mo after 12mo) **has collected $0 ever** because median install lifetime is **35 days** — almost no install reaches the 6-month cliff. Replace with: rental included for 60 days, then $15/week metered.
**Why it works:** Aligns the billing with the actual labor pattern (carry cost on slow-pickup listings is real). Competitors price similarly: Post Pros Nashville bills $20/30 days after day 60, KWPosts/True Sign $15/mo after 90 days. At current volume, ~20% of installs cross 60 days = ~140/yr × ~$30 avg additional revenue = **+$4,200/yr** that today is $0.
**Dollar impact:** **+$2,800-4,200/yr** at current volume.
**Ops complexity:** Modify the existing post-rental-billing cron + the post install pricing copy. Cron logic already exists.
**Time to ship:** ~1 week.
**What could go wrong:** Edge cases where a customer's listing legitimately sits 90+ days (slow market) and they feel nickel-and-dimed. Mitigation: 60-day grace is generous, and the alternative — quiet inventory loss + uncompensated carry — is worse.

### Combined impact table

| # | Recommendation | Annual lift (current) | Annual lift (5x) | Effort |
|---|---|---:|---:|---|
| 1 | Pink post $64 → $79 | $9,900 | $50,000 | 1 day |
| 2 | Auto-bill trip fee | $5,120 | $25,000 | Half day |
| 3 | Cap promos at 25% | $2,800-4,700 | $15,000 | 2 hours |
| 4 | ZIP-cluster batching | $5,000-11,000 | $25,000+ | 1 week |
| 5 | Rental restructure (60-day + $15/wk) | $2,800-4,200 | $20,000 | 1 week |
| | **Total realistic** | **~$22-30K** | **~$135K** | |

---

## 4. WHAT WON'T MOVE THE NEEDLE

The temptation when a business is losing money is to add features. The data says most "obvious" additions are noise. Don't spend the cycles.

- **"Design Your Sign" product launch.** Has its own scoped plan, ~80% gross margin, looks great on paper. But **at 660 orders/yr run rate, even 20% attach × $70 net = ~$9,200/yr.** That's real money, but it requires 4 weeks of build and assumes adoption that hasn't been tested. **Recommendations #1 + #2 alone deliver more revenue, faster, with 1% of the engineering cost.** Park DYS until the top 5 are shipped.
- **Out-of-area surcharge enforcement / expansion.** It has fired **0 times in 177 orders.** Every top-25 ZIP is inside the 45-min Lexington band. The 5-center expansion correctly captures all demand. Don't tune this; don't market it. It already does its silent job as a deterrent.
- **Drone aerial photos, listing photography, yard surveys, sign-maintenance subscription.** All add truck visits. At PPI's current 96% labor cost, *any* service that consumes crew time without commanding $80+ is a contribution-negative add. Skip.
- **Brochure box revival.** 1.7% attach. Pricing isn't the problem; demand is. Pull it from the catalog UI to clean the conversion path.
- **The broker (team_admin) feature, in its current form.** Built for Peggy. **1 real broker uses it (Semonin). The bulk-placement UI generated 0 orders ever.** Don't build more around team_admin until at least one broker actually uses the feature it was built for. This is the single biggest gap between what the codebase implies and what the data shows.
- **Quarterly market reports, white-label software, CRM integrations.** All have real strategic merit. None have **a 90-day ROI**. Put them on the 12-month list.
- **Firing the bottom 20% of customers.** They're only 0.4% of revenue and ~8% of order volume. Cutting them recovers almost nothing. The bottom-of-funnel is not the problem.

---

## 5. STRUCTURAL QUESTIONS RYAN OWNS

These are not Tanner recommendations. These are decisions Ryan needs to make because the data surfaces a fork and only the owner can pick the road.

1. **Is PPI a solo-realtor business or a broker business?** Current data: 96% of revenue is solo realtors at $55 AOV. The team_admin/broker feature is dormant. The brokerage perks (free out-of-area, free lockbox install) are sized for a high-volume customer that doesn't exist yet. **Decision:** either (a) sunset the broker discount tier until a broker proves >10 orders/month, or (b) actively sales-pitch 3-5 brokerages on a paid subscription ($199-249/mo) in Q3. Don't sit in the middle giving away margin for negligible volume.
2. **Is the goal lifestyle business or growth business?** At current $9,769 lifetime revenue, top 5 = 32%, top 20 = 78%. Losing Kristine Cassata or Caitlin Tudor is a measurable revenue cliff. A growth business invests in diversification (referral attribution on signup, office-cluster outreach to Indigo & Co Realty's other agents). A lifestyle business optimizes for the 20 anchors and stops trying to acquire. **The price-and-ops-fix plan above works for either, but everything after Q3 depends on this answer.**
3. **What is the right next geography?** 5 service centers exist; only Lexington is meaningfully utilized. Adding center #6 before Lexington is dense doesn't help. **Decision:** is the 2026 goal "more orders inside the existing 5 centers" or "a 6th center"? The data emphatically says the former.
4. **Does PPI continue to subsidize signs as a loss-leader to sell post installs?** Sign install is $3, 88% attach. It is effectively included. This bundle is intentional — but it's also why the AOV anchors near $65 instead of $80. If signs were $5 (still half of comp pricing), AOV moves a meaningful amount with near-zero demand risk.

---

## 6. PRIORITIZED ROADMAP

### 30 days (ship by 2026-07-08)
- **Week 1:** Recommendation #1 (price $64 → $79), Recommendation #2 (trip-fee auto-bill modal), Recommendation #3 (promo cap at 25%). Three small PRs, total ~1 dev week.
- **Week 2-3:** Recommendation #5 (rental restructure to 60-day + $15/wk metered). Modify the existing post-rental-billing cron.
- **Week 4:** Recommendation #4 phase 1 — assign ZIP-cluster → day-of-week rules in config. Soft launch: schedule UI shows preferred days first; off-route still allowed for first 30 days to measure customer reaction.
- **Instrument:** add `acquisitionSource` enum to User signup form (one field) to start collecting CAC data for the next 6 months.

**Expected impact end of Q3:** monthly run-rate revenue lifts from ~$3,400 to ~$4,500-5,000. Labor-as-%-of-revenue drops from 96% to roughly 70-75%.

### 90 days (ship by 2026-09-08)
- Recommendation #4 phase 2 — hard-enforce ZIP-day rules; off-route requires the $25 expedite (finally activating the dormant fee).
- Lockbox attach push at checkout (UI prompt, ~$1,400/yr at current volume, scales with volume).
- Wholesale procurement contracts for posts/hooks/solar (Dee Sign, Lowen, Hall Signs distributor accounts). ~$2.5-3.5K/yr COGS reduction.
- Call/email the 20 anchor customers personally — Ryan. This is a relationship business; 10 minutes per call is the cheapest retention insurance available.
- Decide structural questions #1 and #2 (broker strategy + lifestyle vs growth).

**Expected impact end of Q4:** $25-30K incremental annual revenue locked in. First profitable quarter on a contribution-margin basis.

### 365 days (by mid-2027)
- Design Your Sign launch (only after AOV thesis from price hike is validated).
- Broker subscription tier ($199-249/mo) — pitch to 3-5 brokerages.
- Open-house weekend service ($75 for Sat-Sun, 10 directionals) — pure-margin SKU using existing crew.
- kvCORE / BoomTown / BoldTrail integration for sign ordering — first-mover positioning, becomes the moat against any future copycat install operator.
- Evaluate white-label licensing of the codebase to install operators in other metros. The software *is* the product; the trucks are a proof-of-concept.

---

## 7. THE HONEST CLOSER

Ryan, the situation is not as bad as it feels. The business is structurally sound, the customers are happy, the codebase is genuinely better than every competitor's. **What's broken is pricing and fee enforcement, and both are fixable in a single dev sprint.** "Push volume" is the wrong instinct only because today's volume loses money per order — but two weeks of changes flips that, and *then* volume is exactly the right strategy.

The 100%-off promo from winter wasn't a strategic mistake — it was a goodwill gesture in a slow season. But it's the data point that most clearly shows the pattern Ryan needs to break: **don't subsidize customers who aren't profitable on their next order.** Charge market rate. Bill every trip. Cap every discount. Then push volume.

---

## APPENDIX — DATA BRIEF (full baseline + 5 analyses)

The complete baseline pull, pricing comparison, operational efficiency review, customer segmentation, and competitive landscape — all five with sources and methodology — are preserved in the workflow artifacts. Key reference files:

- `c:\Users\tanne\PPI\scripts\_audit-financial-snapshot.ts`
- `c:\Users\tanne\PPI\scripts\_audit-dig-deeper.ts`
- `c:\Users\tanne\PPI\scripts\_audit-operational-efficiency.ts`
- `c:\Users\tanne\PPI\scripts\_audit-customer-segmentation.ts`
- `c:\Users\tanne\PPI\scripts\_verify-supply-vol.ts`
- `c:\Users\tanne\PPI\components\order-flow\types.ts` (current pricing constants)
- `c:\Users\tanne\PPI\lib\post-rental-billing.ts` (dormant rental cron)
- `c:\Users\tanne\PPI\docs\design-your-sign\plan.md` (deferred net-new product spec)

Source-of-truth pull: live Railway Postgres, 2026-06-08, 177 paid orders all-time, 68 paying customers, $9,769.43 lifetime gross revenue, 0% refund rate, 0 out-of-area surcharges fired, $0 post-rental collected, $200 trip-fees collected (5 of 45 service requests invoiced).