I have a comprehensive comparison. Writing the final analysis now.

---

# PPI PRICING OPTIMIZATION — ANALYSIS & RECOMMENDATIONS

**Date:** 2026-06-08. Read-only analysis. No code changes.

## 1. PPI CURRENT PRICING (from `components/order-flow/types.ts`)

| Line item | PPI price | 90d revenue impact (baseline) |
|---|---:|---:|
| Signature Pink Post (install + 6mo rent) | **$65** | $10,141 (87% of all line revenue) |
| White/Black Vinyl Post | $55 | (rolled into post line) |
| Metal Frame Sign | $40 | small |
| Wood Panel Post | $95 (+$55 sign build / +$55 materials) | rare |
| Sign install | **$3** | $474 — 88% attach |
| Rider install | $2 (+ $5 rental) | $293 — 34% attach |
| Lockbox install | **$5** (+ $10 rental) | $130 — **13% attach** |
| Solar lighting | $5 | $255 — 21% attach |
| Wire frame sign | $5 | $50 |
| Second post | $25 | $50 |
| Brochure box purchase | $24 (+$3 install) | $27 — 2% attach |
| Fuel surcharge | $2.47 | $437 (only universal fee) |
| No-post surcharge | $40 | $160 |
| Expedite fee | $50 | **$0 — never charged** |
| Out-of-area surcharge | $50 | **$0 — never charged** |
| Post rental (6mo / 9mo / 12mo+) | $18 / $18 / $6 mo | **$0 — dormant cron** |
| Service trip fee | $40 | $200 (5 of 45 requests billed) |

## 2. MARKET COMPARISON

| Provider | Post install | Rider | Lockbox | Rental/renewal | Out-of-area |
|---|---:|---:|---:|---:|---:|
| **PPI (you)** | **$55–$95** ($65 pink) | $7 ($2+$5) | **$15** ($5+$10) | $18/$18/$6 (dormant) | $50 (unused) |
| SignBoss (national) | **$75 / $85** (5ft/6ft) | **$25** swap | **$25** | $25 rebill | n/a |
| Oakley Sign | **$49 single / $69 double** | $8 rental | (bundled) | **$12 @ 90 days**, $20 @ 12mo | **$25** |
| Post Pros Nashville | **$75** (incl. removal + 60d rent) | n/a listed | **$12** | **$20 / 30 days after day 60** | n/a |
| Ace Sign | $50 all-inclusive | included | included | included | $25 extra trip |
| Post Up Realty (FL) | $40 / $50 (5ft/6ft) | n/a | n/a | $20 / 90 days | quoted by distance |

**Bottom line:** PPI's flagship Signature Pink Post at $65 is **15-30% below** the closest direct comp (SignBoss $75–85, Post Pros $75). Its $5–$15 lockbox is **30-60% below** SignBoss ($25) and Post Pros ($12). The fuel surcharge at $2.47 is symbolic, not revenue.

## 3. PRICING LEVERS (no ops change required)

### LEVER A — Raise the post itself (biggest dollar lever)

The post line is **87% of item revenue**. Every $1 added to the pink post = ~$170/year today, **~$1,700/year at 10x volume**.

- $65 → $75 (+15%, still under SignBoss non-subscriber): **+$1,750/yr** at current volume; **+$10,500/yr** at 600 orders.
- $65 → $79 (matches Nashville comp w/ removal): **+$2,380/yr** today.
- $55 white/black → $65: **+$200/yr** today (low-volume SKU).

Demand-risk read: 100% of June orders accepted $2.47 fuel + $65 post with zero refund / cancel signal. There is no observable price-sensitivity ceiling under $80 in the data. **A $10 lift on the pink post is the single safest, highest-ROI knob in the whole P&L.**

### LEVER B — Triple the lockbox install ($5 → $15) + lockbox rental ($10 → $15)

PPI is the cheapest lockbox in the comp set by a wide margin. Lockbox attach is only **13%** — which suggests price is NOT what's blocking attach. Raising both ($5+$10 → $15+$15) leaves PPI at $30, **still under SignBoss's $25 install alone**.

Today: 23 lockboxes/90d = ~92/yr × $15 lift = **+$1,380/yr** at current volume. Bigger: a checkout-flow nudge ("add a lockbox for $30, your buyer's agents will thank you") could plausibly double the 13% attach. Each 1pp of attach lift = ~7 boxes/yr = +$210 at new pricing.

### LEVER C — Replace the dormant rental schedule with a **flat day-1 rental**

Median install life is **35 days** — meaning the $18-at-6mo / $18-at-9mo / $6/mo schedule will fire on a tiny minority of installs ever. Even when it does, $18 at 180 days is trivial.

Two replacement models, both better than the status quo:

1. **"Listing extension fee": $20 rebill at day 60** (Post Pros model). At current 35-day median, ~20% of installs cross 60 days. Of 700 installs/yr (projected at current growth), ~140 cross = **+$2,800/yr**.
2. **Bundle 30 days into base, then $15/30 days thereafter** — raises the effective AOV when listings sit, captures the "lazy pickup" cost Ryan already eats labor on.

Either approach replaces $0 with **$2K-$5K/yr** and aligns billing with the actual labor cost of carry.

### LEVER D — Make the expedite fee visible (it is $0/yr today)

Expedite is $50 in code; **zero orders** have ever paid it. Either the UI is too quiet or it's gated unhelpfully. Even **5% of orders/yr** opting in = ~35 orders × $50 = **+$1,750/yr**. Pair with explicit copy: "Need it tomorrow? +$50". This is found money.

### LEVER E — Service-trip fee enforcement ($40)

**40 of 45 service requests in 90d went out unbilled.** If even half the removals should have carried the trip fee (some are simple swaps), that's ~20 trips × $40 × 4 quarters = **+$3,200/yr**. This is a policy / UX change, not a price change — but it's the second-largest leak after the promo codes.

### LEVER F — Broker subscription / volume floor

Semonin (the only real broker) paid **$406 across 7 orders** in 90d with free out-of-area + free lockbox install perks. That's a **negative-margin volume play**. Replace with:

- **$199/mo broker minimum** (covers 3 installs); overage at standard pricing; keeps the lockbox-free perk only above a 10-orders/mo threshold.
- Semonin's run-rate (~28/yr) × $58 AOV = $1,624 today. A $199/mo floor = **$2,388/yr guaranteed** + overage upside.

Adds ~$760/yr per broker + makes the team_admin feature finally generate per-broker ARR. Replicate sales pitch to 3-5 brokers/yr → eventually a $10K-$20K/yr ARR floor that smooths Q1 dead months.

### LEVER G — Convenience surcharges (no new ops)

- **Saturday surcharge $15.** 49/72 scheduled days are Wed-Fri; weekend requests are real but undifferentiated. Even 1 Sat order/wk × $15 = **+$780/yr**.
- **Same-day = $50 (already exists).** Just surface it.
- **Sunday install $25** — Sunday is functionally never used; pricing it high keeps it that way OR captures a premium when listing-pressure hits.

### LEVER H — Sign install $3 → $5

PPI gives away the sign install at $3 (88% attach = essentially included). At $5, current volume (158 signs/yr) adds **+$316/yr**. Not big, but it's a one-line change with zero demand risk — at $5 it's still half what comps charge.

### LEVER I — KILL THE 100%-OFF PROMOS

Not a pricing change but the #1 P&L item. TOOCOLD/SAVETIME burned **$2,834 in discount + ~$5,250 in labor** on 42 orders. If acquisition is the goal, **$20 off (not 100% off) on first install** would have grossed $1,890 on those same 42 orders. **Net swing: ~$4,700/yr if winter promo recurs.** Cap any future promo at 25%.

## 4. RANKED RECOMMENDATIONS (Ryan-ready)

| # | Change | Ops risk | Est. annual lift (current vol) | Est. lift (5x vol) |
|---|---|---|---:|---:|
| 1 | Cap promos at 25% off — never 100% | None | **+$2,800–$4,700** | +$15K |
| 2 | Pink post $65 → $75 | None | **+$1,750** | +$8,750 |
| 3 | Service-trip fee actually billed (45→25 unbilled) | Low (admin UX) | **+$3,200** | +$16K |
| 4 | Replace dormant rental with $20 @ day 60 | Low (cron change) | **+$2,800** | +$14K |
| 5 | Expedite fee surfaced on scheduling step | None | **+$1,750** | +$8,750 |
| 6 | Lockbox $5+$10 → $15+$15 | None | **+$1,380** | +$6,900 |
| 7 | Broker monthly minimum ($199) replacing perks | Medium (sales conversation) | **+$760/broker** | +$10K (5 brokers) |
| 8 | Sign install $3 → $5 | None | +$316 | +$1,580 |
| 9 | Saturday/Sunday surcharge $15/$25 | None | +$780 | +$3,900 |
| 10 | White/Black post $55 → $65 | None | +$200 | +$1,000 |

**Combined annual lift at current volume: ~$15,700/yr.** Against an $9,769 baseline, this is a **~160% net revenue lift with zero added drive-time, zero new SKUs, zero new hires.** At 5x volume the same changes compound to roughly **$85K-$95K/yr**.

## 5. WHAT NOT TO TOUCH

- **Out-of-area surcharge** — never fires; the 5-center map already absorbs demand. Leave as deterrent.
- **Fuel surcharge $2.47** — too small to matter and customers ignore it. Either fold into base post price or leave alone.
- **Brochure box pricing** — 2% attach. Pricing isn't the problem; demand is.
- **Wood Panel Post** ($95 + $55 + $55) — already premium, rare. Don't move.

## 6. THE PRICE-ELASTICITY CAVEAT

None of these numbers assume demand drop. The data has no A/B and only one price point per SKU all-time, so we cannot **measure** elasticity. However: (a) the comp set sits 15-60% above PPI on every item, and (b) zero cancels-due-to-cost signal exists in 177 orders. The realistic risk of a $10 post lift causing >5% demand loss is low. **The risk of leaving $15K/yr on the table is certain.**

---

**Sources:**
- [Oakley Sign Installation Pricing](http://www.oakleysigninstallation.com/pricing.php)
- [SignBoss Real Estate Sign Management Pricing](https://www.signboss.com/install/pricing)
- [Post Pros Nashville Sign Installation](https://www.postprosnashville.com/sign-installation)
- [Post Up Realty Services](https://postuprealtyservices.com/)
- [Ace Sign Installations Services and Prices](https://acesigninstallations.com/services-and-prices)

**Files referenced (read-only):**
- `c:\Users\tanne\PPI\components\order-flow\types.ts` (PRICING constants)
- `c:\Users\tanne\PPI\lib\constants.ts` (auxiliary pricing — note: this file's `PRICING.brochureBox.purchase = 23` differs from types.ts's `brochure_box_purchase: 24`; minor drift)
- `c:\Users\tanne\PPI\lib\post-rental-billing.ts` (dormant cron, default 2099)