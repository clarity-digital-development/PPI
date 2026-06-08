# ADVERSARIAL CRITIQUE — PPI Profitability Strategy

**Reviewer: Claude (skeptic role) — 2026-06-08**

---

## OVERALL TAKE

The synthesis is directionally right but **mathematically loose in ways that will bite Tanner if Ryan checks the math**. Three of the five recommendations are defensible. Two have meaningful holes. The bigger problem: the dollar-impact column projects "annual lift at current volume" using a 365-day annualization of a business that did **95% of its revenue in the last 90 days**. That's not a baseline — that's a forecast dressed as one. Ryan will notice.

---

## PER-RECOMMENDATION PRESSURE TEST

### #1 — Price $63.95 → $79 — **MOSTLY RIGHT, MATH IS OFF**

**Hidden assumption:** "660 orders/yr run rate" comes from annualizing the last 90 days (166 × 4 = 664). But the business grew **20 → 52 → 72** orders/month Feb-May. Either the run-rate is much higher than 660 (last-3-months annualization) or much lower (lifetime average ≈ 177). Picking the middle to defend a number is sloppy.

**Real downside Ryan eats if wrong:** zero price elasticity is asserted from a dataset where prices have been static. **You cannot infer elasticity from non-variance.** The June AOV jump from $54 → $76 was *promo removal*, not a price increase — that's not the same experiment. A 23% price hike on the headline SKU could lose 5-15% of marginal solo agents who are deciding between "PPI" and "my brother-in-law with a posthole digger." That's the actual competitive set for the bottom half of the customer base, not InstallNow.io.

**Better framing:** $79 is probably right, but stage it. **$72 for 60 days, measure conversion, then $79.** Same destination, lower risk of an unforced volume cliff during the critical Q3 selling season.

**Second-order miss:** raising the post price without touching the sign ($3) keeps the bundle unbalanced. If you're going to touch pricing, **raise signs $3 → $7** at the same time — that's the highest-leverage stealth lift in the catalog and the synthesis acknowledges it then doesn't act on it.

---

### #2 — Auto-bill the trip fee — **STRONGEST RECOMMENDATION, IMPACT OVERSTATED**

**Solid:** the mechanism works (5/5 collection). The UX gap is real. This is the cleanest revenue leak.

**Math problem:** "32 unbilled trips/quarter × $40 × 4 = $5,120/yr" assumes **100% billing rate going forward**. That's the ceiling, not the expected. Realistic recovery is probably 60-75% — some trips genuinely shouldn't be billed (PPI's own scheduling errors, warranty pickups, anchor-customer goodwill). Honest number is **$3,000-3,800/yr**, not $5,120.

**Downside Ryan eats:** customer service complaints from agents who didn't read fine print. At 40 service requests/quarter and a 5-10% "I didn't know" rate, that's 2-4 awkward calls per quarter. Manageable but real. Mitigation the synthesis didn't mention: send a one-time "starting [DATE], trip fees auto-bill per the published schedule" email to the 68 paying customers. Cheap insurance.

---

### #3 — Cap promos at 25% — **CORRECT CONCLUSION, BAD ARITHMETIC**

The synthesis says: "15 of 42 promo customers came back at full price (LTV $173) = $2,591 recovered. Net loss ~$5,500."

**This is the strongest claim in the document and it's not sourced anywhere in the baseline data.** The baseline says "27 of the 42 promo recipients have NOT placed a second paid order yet (rough count)." Where did **LTV $173** come from? Where did **15 returned** come from? These look reverse-engineered to make the math close. **Tanner cannot defend these numbers to Ryan.**

**What's actually true from the data:** 42 customers paid $2.47 each. ~15 returned (per the cross-reference). The remaining margin question is unknowable without per-customer LTV pulled from the DB, which the baseline didn't do.

**Fix before shipping:** soften the number to **"~$2,800/yr in directly foregone revenue"** (which IS in the data — the $2,834 discount line) and drop the labor-loss claim. The labor was paid either way; treating it as recoverable assumes you'd have refused those 42 orders, which Ryan wouldn't have.

**Second-order effect missed:** the 100%-off promos may have been a **brand-building loss leader** in PPI's first real winter. Some of those 42 customers told their broker about PPI. Word-of-mouth attribution isn't in the data. The synthesis dismisses this too quickly. Recommendation still right (cap at 25%), but the framing should be "we can't measure WOM lift, so we cap downside" — not "promos lost money, period."

---

### #4 — ZIP-cluster batching — **DIRECTIONALLY RIGHT, MOST FRAGILE RECOMMENDATION**

**Biggest assumption:** that customers will accept "Georgetown is Mon/Wed/Fri only." In real estate, **list-to-install timing is contractually sensitive**. Realtors sign a listing agreement Monday and need a sign in the yard by Tuesday showing. Telling Kristine Cassata (top customer, 13 orders) "your Georgetown listing has to wait until Wednesday" is a real risk of losing the anchor.

**Concrete conflict with synthesis section 5:** the doc says "losing Kristine or Caitlin is a measurable revenue cliff" and then proposes a policy that would most affect them (both are heavy Georgetown/Lex users). **These two recommendations are in tension and the synthesis doesn't acknowledge it.**

**Better staging:** soft preference (UI defaults to cluster days, off-cluster still bookable) **forever**, plus a **$15 off-route discount for booking on the cluster day** rather than a $25 surcharge for off-route. Carrots route demand; sticks lose anchors.

**Dollar estimate ($5-11K/yr) is hand-wavy.** Going from 1.85 → 4 stops/day requires demand density that may not exist on the "preferred" day. If Mon/Wed/Fri Georgetown demand is 5 orders/week total, you've created three 1.7-stop days instead of two 2.5-stop days. **The synthesis doesn't compute density per cluster — it assumes density will appear.**

---

### #5 — Rental restructure to 60-day + $15/wk — **HALF RIGHT**

**Right:** the current schedule is dormant because median install is 35 days. **Wrong:** the proposed replacement still misses most installs. If median is 35 days and the new free window is 60 days, **~70% of installs still pay $0 rental**. The math claim "~20% of installs cross 60 days × 140/yr × $30 = $4,200/yr" assumes (a) 700 installs/year (5x current run rate) and (b) average $30 of metered rental. **At current volume that's ~$840/yr, not $4,200.**

**Better proposal:** raise the base post install fee by $5 (which is what the rental was supposed to compensate for anyway), keep the rental schedule as a long-tail recovery for slow-pickup edge cases, and ship it as part of Recommendation #1. **Two pricing changes in one PR is cleaner than two pricing systems.**

---

## DIAGNOSIS — WHAT THE SYNTHESIS MISSED

1. **CAC is unknown and the doc treats it as zero.** PPI has acquired 68 customers but the data has no attribution. Are they coming from Google, referrals, Ryan's personal network, or the promo blasts? Without this, "lifestyle vs growth" is undecidable and the broker recommendation is unfounded. The recommendation "add acquisitionSource to signup" is buried in week 4 — it should be **week 1, day 1.**

2. **The 234% naive labor number is a strawman.** No business runs without routing. Quoting it inflates the urgency rhetorically but undermines credibility — Ryan will say "obviously I don't run one truck per order." Drop it; lead with the 96% realistic number.

3. **Fuel cost is asserted ("$1,000+ spent") with no source.** Either pull actual fuel from expense data or remove the parenthetical.

4. **The crew is one person, not two, on small jobs** — this should be confirmed with Ryan, not assumed. If single-person installs are happening for sign-only pickups, the labor math is materially different.

---

## "WON'T MOVE THE NEEDLE" — ONE BAD CALL

**Design Your Sign deferral is probably right, BUT** the synthesis dismisses it on "$9,200/yr at 20% attach" and then claims Recommendation #5 (rental, $2,800-4,200/yr) is worth shipping. **DYS produces more revenue than #5 with similar effort.** Either both are worth doing or neither is. The inconsistency is visible.

**Brochure box pull from catalog** is unaddressed in the roadmap. If it's truly dead (1.7% attach), removing it cleans the conversion funnel — that's a 1-hour change with real UX value and zero downside.

---

## ROADMAP REALISM

Ryan is a small business owner running trucks. The 30-day plan assumes **1 dev week of Tanner's time** plus Ryan's bandwidth to handle customer pushback on three simultaneous changes (price hike, trip-fee enforcement, promo cap). **Shipping all three in week 1 is too much customer-facing change at once.** Stage:
- Week 1: trip-fee auto-bill (internal, invisible to customers)
- Week 2: promo cap (invisible to existing customers)
- Week 3-4: price hike (visible; needs an email)

This sequencing is also better psychologically — Ryan gets two quick wins (#2 and #3) before the riskiest move (#1).

---

## CONCRETE EDITS BEFORE SHIPPING TO TANNER

1. **Replace "660 orders/yr run rate"** with explicit "last-90-days annualized ≈ 660" and add a footnote that this assumes growth holds.
2. **Drop the LTV $173 / 15 returned claim in Recommendation #3** unless the per-customer DB pull is run to verify. Re-anchor on the verifiable $2,834 discount line.
3. **Stage Recommendation #1 as $72 → $79** with a 60-day measurement window. Also raise signs $3 → $7 in the same PR.
4. **Reframe Recommendation #4 as a carrot ($15 off-cluster discount)**, not a stick. Acknowledge tension with the "don't lose anchor customers" point in section 5.
5. **Cut the Recommendation #5 dollar estimate to $800-1,500/yr** at current volume, or fold the change into Recommendation #1 as a $5 base-fee lift.
6. **Move "add acquisitionSource field" to Week 1, Day 1.** Six months of CAC data is the single most valuable instrumentation the business can ship.
7. **Drop the 234% naive labor stat.** Lead with 96% only.
8. **Add a Recommendation #6:** remove brochure box from catalog (1 hr, cleans funnel).
9. **Add an explicit caveat:** "All dollar projections assume current 90-day order volume holds. Q3 seasonality unknown."
10. **In Section 5, acknowledge that #4 (ZIP batching) conflicts with anchor-retention** and resolve the tension explicitly.

**Bottom line for Tanner:** the strategy is right. The numbers are oversold by ~30%. Fix the math, stage the rollout, instrument CAC, and this is a defensible doc Ryan will actually act on.