Now I have a very complete picture. The data is extraordinary in what it reveals. Let me write the brief.

The headline findings:
1. **42 orders (23.7%) used 100%-off promo codes (TOOCOLD, SAVETIME)** discounting away $2,833 — these collected only $2.47 fuel surcharge each. This is the single biggest revenue leak.
2. **Service-area surcharge NEVER fired** — 0 orders surcharged out of 177. All top ZIPs fall within Lexington's standard 45-min band.
3. **177 paid orders all-time** total only $9,769 — true install AOV (excluding the $2.47 promo orders) is much higher.
4. **Multi-stop is happening** (avg 1.85 stops/day) but nowhere near amortized.
5. **0 post-rental charges have ever been collected** despite 4 installs already crossing 90 days.
6. **Top 20 customers = 78% of revenue** — concentrated.

Let me synthesize this into the brief. Output below.

---

# PPI FINANCIAL AUDIT — DATA BRIEF
**Pulled: 2026-06-08 from live Railway Postgres. 177 paid orders all-time. Read-only.**

## TL;DR — what the data actually says

1. **There is almost no business to be profitable on yet.** Total all-time paid revenue is **$9,769.43** across **177 orders** placed by **68 paying customers**. The whole company has done <$10K gross in its lifetime. "Margin" framing is premature; the volume itself is the problem.
2. **23.7% of paid orders were 100%-off promos.** Two codes — `TOOCOLD` and `SAVETIME` — gave 42 customers a free install and collected only the $2.47 fuel surcharge. That alone gave away **$2,833 (29.0% of gross)** and pulled the median order in Feb 2026 to **$2.47**.
3. **The $50 out-of-area surcharge has never fired. Not once.** 0 of 177 paid orders have `serviceAreaSurchargeCents > 0`. Looking at the 25 ZIPs with the most orders, every single one falls inside Lexington's 45-minute standard band (closest is `42701` Elizabethtown ZIP at 1 mile from its center; furthest top-25 ZIP is 35 miles / 38 minutes — still standard). The drive-time surcharge is theoretical revenue protection, not a current revenue stream.
4. **Post-rental billing has collected $0.00 ever.** `PostRentalCharge` table is empty. Active install pipeline has 138 still-active installs, but only 4 have crossed 90 days and none have crossed 180 — so the schedule isn't even due yet. The mechanism works on paper; nothing has tested live.
5. **Labor cost — even with crew time amortized across multi-stop days — runs ~96% of revenue.** Best-case routing model (60 min round-trip drive + 30 min per stop, 2-person crew at $25/hr) eats nearly every dollar before supplies, fuel, or admin. Naive per-order labor (no routing) is 234% of revenue. The unit economics are upside-down.
6. **Customer base is shallow and bursty.** 68 ever-paid customers; 63 active in last 90 days. Top 5 customers = 32% of revenue, top 20 = 78%. **48.5% of customers have placed exactly 1 order.** Only 2 customers (Kristine Cassata, Caitlin Tudor) have crossed 10 lifetime orders.

---

## 1. REVENUE BASELINE

| Window | Orders | Gross | Refunded | Net |
|---|---:|---:|---:|---:|
| Last 30 days | 86 | $5,470.02 | $0.00 | $5,470.02 |
| Last 90 days | 166 | $9,694.56 | $0.00 | $9,694.56 |
| Last 365 days | 177 | $9,769.43 | $0.00 | $9,769.43 |

**Read:** essentially 100% of business has happened in the last 90 days. PPI is functionally a 3-month-old going concern, not a mature one. Refund rate is 0%.

### Monthly trend (paid only)

| Month | Orders | Revenue | AOV | Median |
|---|---:|---:|---:|---:|
| 2026-02 | 6 | $62.52 | $10.42 | $2.47 |
| 2026-03 | 20 | $979.02 | $48.95 | $63.95 |
| 2026-04 | 52 | $2,732.86 | $52.56 | $66.07 |
| 2026-05 | 72 | $3,930.24 | $54.59 | $69.25 |
| 2026-06 (partial) | 27 | $2,064.79 | **$76.47** | $63.95 |

**Read:** order count growing month-over-month (good). AOV trending up — June's $76 jump is the **single best directional signal in the dataset** — likely because the TOOCOLD promo wound down. May had 18 SAVETIME promo orders dragging it lower.

---

## 2. ORDER VOLUME

| Window | Total | succeeded | refunded | cancelled |
|---|---:|---:|---:|---:|
| 30d | 86 | 86 | 0 | 2 |
| 90d | 166 | 166 | 0 | 2 |
| 365d | 177 | 177 | 0 | 3 |

- **Refund rate:** 0/177 all-time. Either customers are happy or the refund flow hasn't been exercised at scale yet.
- **Active paying customers last 90d:** 63
- **Avg orders / active customer / month:** 0.88

---

## 3. CUSTOMER BREAKDOWN

| Role | Count |
|---|---:|
| customer | 96 |
| team_admin | 2 |
| admin | 1 |

### Brokers (team_admin)

| Broker | Login-agents | Managed-roster | Revenue placed-by | Direct revenue | Total | Orders |
|---|---:|---:|---:|---:|---:|---:|
| **Semonin Broker Account** | 1 | 9 | $0.00 (0) | $406.31 (7) | $406.31 | 7 |
| Ryan Test (Team Admin) | 1 | 13 | $0.00 (0) | $0.00 (0) | $0.00 | 0 |

**Read:** the team_admin/broker feature exists for exactly one real broker (Semonin), and it's **not being used as designed**. Zero orders have `placedByUserId = broker`. All 7 Semonin orders are agents logging in themselves and placing orders. The broker dashboard built for Peggy/Semonin is being treated as just another agent login — the bulk-placement UI isn't generating volume. The Semonin team perks (out-of-area exempt, free lockbox install via `freeLockboxInstall`) are giving away margin for ~$58 AOV orders.

### Top 20 customers by lifetime revenue (truncated to top 10 here)

| # | Name | Email | Role | Revenue | Orders | AOV |
|---:|---|---|---|---:|---:|---:|
| 1 | Kristine Cassata | kristine@indigoandco.realty | customer | $874.81 | 13 | $67.29 |
| 2 | Caitlin Tudor | ctudor@semonin.com | customer | $639.50 | 10 | $63.95 |
| 3 | Nick Ratliff | nick@nrrt.com | customer | $592.16 | 8 | $74.02 |
| 4 | Derrick Plunkett | danae.kwcommercial@gmail.com | customer | $552.25 | 3 | **$184.08** |
| 5 | Philip "PJ" Elder | ba@pjelder.com | customer | $490.76 | 6 | $81.79 |
| 6 | Jonathan Wood | jdwcdw24@yahoo.com | customer | $433.87 | 7 | $61.98 |
| 7 | Nicole Maxwell | nicole@indigoandco.realty | customer | $428.57 | 7 | $61.22 |
| 8 | Semonin Broker | supportstaff@semonin.com | team_admin | $406.31 | 7 | $58.04 |
| 9 | Victoria Byrd | victoria@bhgky.com | customer | $396.42 | 6 | $66.07 |
| 10 | Carlos Elliott | carlos@elliottrealtygroupky.com | customer | $335.65 | 5 | $67.13 |

**Concentration:** top 5 = 32.2% of revenue, top 10 = 52.7%, top 20 = 78.3%, top 50 = 99.5%. **The bottom 18 customers contributed 0.5% combined.**

### Repeat behavior

| Lifetime orders | Customers | % |
|---|---:|---:|
| 1 | 33 | 48.5% |
| 2 | 13 | 19.1% |
| 3-4 | 12 | 17.6% |
| 5-9 | 8 | 11.8% |
| 10+ | 2 | 2.9% |

**Half the paying customer base has only placed one order ever.** Retention/repeat is the obvious lever.

---

## 4. GEOGRAPHIC DISTRIBUTION

**0 of 177 paid orders triggered the $50 out-of-area surcharge.** None even have `serviceAreaCenterId` populated — the persisted field is empty on every row, suggesting the resolve pipeline isn't writing it back at checkout (the calc works at gate-check; persistence appears to be a no-op).

Closest center & drive-time for top 25 ZIPs (computed live via haversine):

| ZIP | Orders | Closest center | Miles | Min | Tier |
|---|---:|---|---:|---:|---|
| 40324 (Georgetown) | 27 | Lexington | 14.4 | 16 | standard |
| 40356 (Nicholasville) | 11 | Lexington | 12.0 | 13 | standard |
| 40509 (Lex SE) | 11 | Lexington | 7.5 | 8 | standard |
| 40353 (Mt Sterling) | 8 | Lexington | 30.2 | 33 | standard |
| 40511 (Lex N) | 7 | Lexington | 7.3 | 8 | standard |
| 40391 (Winchester) | 6 | Lexington | 20.1 | 22 | standard |
| 40361 (Paris) | 5 | Lexington | 19.5 | 21 | standard |
| 40475 (Richmond) | 5 | Lexington | 22.1 | 24 | standard |
| 40403 (Berea) | 4 | Lexington | 35.0 | 38 | standard |
| 42701 (E-town) | 4 | Elizabethtown | 1.2 | 1 | standard |
| 41031 (Cynthiana) | 4 | Lexington | 28.1 | 31 | standard |
| 40601 (Frankfort) | 4 | Lexington | 24.0 | 26 | standard |
| 40299 (Lou SE) | 3 | Louisville | 14.8 | 16 | standard |
| 47111 (IN) | 2 | Louisville | 16.3 | 18 | standard |
| 40165 (Shepherdsville) | 2 | Bardstown | 17.8 | 19 | standard |

**Read:** the 5-center expansion correctly captures the demand — no top ZIP falls outside standard. The drive-time model (45-min Lexington band) is generous; the longest top-25 leg is 38 minutes. There is no out-of-area revenue to capture here, but there's also no margin pain from out-of-area drives.

### Service centers in DB

- Lexington (40507) — standard 45 / surcharge 105 min
- Louisville (40202) — standard 45 / surcharge 90 min
- Cincinnati (45202) — standard 45 / surcharge 90 min
- Elizabethtown (42701) — standard 25 / surcharge 60 min
- Bardstown (40004) — standard 25 / surcharge 60 min

---

## 5. SERVICE MIX

### Revenue by item type (paid orders, all-time)

| Item type | Units | Revenue | Orders w/ it | Avg $/order |
|---|---:|---:|---:|---:|
| post | 175 | $10,141.00 | 171 | $59.30 |
| sign | 158 | $474.00 | 156 | $3.04 |
| rider | 73 | $293.00 | 60 | $4.88 |
| solar_lighting | 51 | $255.00 | 37 | $6.89 |
| lockbox | 23 | $130.00 | 23 | $5.65 |
| wire_frame_sign | 10 | $50.00 | 6 | $8.33 |
| second_post | 2 | $50.00 | 2 | $25.00 |
| brochure_box | 3 | $27.00 | 3 | $9.00 |
| misc | 2 | $58.00 | 1 | $58.00 |

### Order-level revenue buckets

| Bucket | Revenue | % of total |
|---|---:|---:|
| Subtotal (OrderItem sum) | $11,478.00 | 117.5% |
| Fuel surcharge | $437.19 | 4.5% |
| No-post surcharge | $160.00 | 1.6% |
| Out-of-area surcharge | $0.00 | 0.0% |
| Expedite fee | $0.00 | 0.0% |
| **Discount** | **$-2,834.00** | **-29.0%** |
| **TOTAL** | **$9,769.43** | 100% |

**Three loud signals:**
- **The post IS the business.** $10,141 of $11,478 gross item revenue is the post itself. Signs/riders/lockboxes are accessory revenue ($1,279 combined).
- **29% of gross was discounted away.** This is the highest-leverage knob in the entire P&L.
- **Expedite fee has never been charged** ($0 / 0 orders). Either nobody chose it, or the UI isn't presenting it.

### Attach rates (% of paid orders containing item)

| Item | % attach |
|---|---:|
| post | 96.6% |
| sign | 88.1% |
| rider | 33.9% |
| solar_lighting | 20.9% |
| lockbox | **13.0%** |
| brochure_box | 1.7% |

**Read:** posts and signs are bundled (88.1% attach). Riders attach 1-in-3 — there is genuine upsell room. Lockbox attach is **13%** — and lockboxes are the single highest-margin SKU per Ryan's previous discussions (mostly inventory you already own). Brochure boxes effectively never attach.

---

## 6. SERVICE REQUESTS & TRIP FEES

| Type | Count (90d) |
|---|---:|
| removal | 34 |
| service | 11 |

- Total service requests last 90d: **45**
- Service requests with invoice billed: **5**
- Service requests with invoice PAID: **5** (100% collection)
- Trip-fee revenue (all-time): **$200.00** (5 invoices, avg $40)

**Read:** 45 service requests, 5 invoices. **40 service requests in 90 days went out the door without a trip-fee charge.** If half were billable $40 trips, that's another $800/quarter — small but the leak is real, especially compounded with the labor cost of those un-billed visits.

The 34 removal requests are pickup-only trips. At ~$25/hr labor × 2-person crew × (drive + onsite), each unbilled pickup costs Ryan ~$30-50 in labor. **34 unbilled pickups in 90 days ≈ $1,000-1,700 in labor cost not recovered.**

---

## 7. ACQUISITION & CHURN

### New users by month

| Month | New customers | New brokers |
|---|---:|---:|
| 2026-01 | 4 | 0 |
| 2026-02 | 18 | 0 |
| 2026-03 | 15 | 0 |
| 2026-04 | 27 | 0 |
| 2026-05 | 28 | 1 |
| 2026-06 (partial) | 4 | 1 |

**Read:** April-May was the acquisition surge. June is shaping up softer — but it's only 8 days in.

- Customers who ever paid: **68**
- Active (paid within 90d): **63**
- Inferred churned (last order >90d ago, first order >180d): **0**

**Churn is not a measurable problem yet — the business is too young to know.** The deeper question is whether the 33 one-order customers will ever come back.

---

## 8. UNIT ECONOMICS — the painful one

### Naive per-order labor (no routing)

Model: 2-person crew @ $25/hr, 4 drive-legs per order (install round-trip + pickup round-trip), 20 min onsite install + 15 min onsite pickup, drive minutes from order's nearest center (midpoint of standard band when no surcharge).

- Total estimated labor: **$22,862.50**
- Total revenue: $9,769.43
- **Labor as % of revenue: 234.0%**
- **Orders with negative margin before supplies/fuel: 175 of 177 (98.9%)**

### Realistic with routing (drive amortized per scheduled day)

Days with 1 install: 19. Days with 2-4 installs: 19. Days with 5-9: 1. Days with 10+: 0. **Average 1.85 installs per active day.**

Model: 60 min round-trip drive per day + 30 min per stop, 2-person crew @ $25/hr.

- Total revenue on scheduled-day rows: $3,886.78
- Estimated install labor: $3,750.00
- **Labor as % of revenue: 96.5%** (install only; pickup roughly doubles this)

**This is the structural problem.** Even with routing assumptions that favor Ryan (60 min round-trip is generous for Lex-only days), labor for the install leg alone consumes ~96% of revenue. Add pickup labor, fuel ($437 collected vs probably $1,000+ spent), supplies (posts/signs amortized), and the company is structurally underwater per order.

**Two things that move this number:**
1. **Higher AOV** (June already shifted from $54 → $76 by killing free-install promos)
2. **Higher stops-per-day** (going from 1.85 → 4 stops/day cuts labor-per-order ~40%)

### 15 worst-margin orders

All 15 are $2.47 totals from the TOOCOLD/SAVETIME promo, all with ~$129 estimated labor, all margin **-$126.70**. The free-install promo created **42 negative-margin orders, each losing ~$125 in labor and supplies.** Total promo bleed: ~$5,250 in labor on orders that grossed $103 combined.

---

## 9. THE BIG SURPRISES

1. **The TOOCOLD/SAVETIME 100%-off promos burned ~$5,250 in labor** to acquire 42 customers who paid $2.47 each. If even half become repeat customers at $65 AOV, payback takes ~2.5 orders each. **27 of the 42 promo recipients have NOT placed a second paid order yet** (rough count from cross-referencing top-20 list). This was likely positioned as a winter-weather goodwill gesture; in P&L terms it was a customer-acquisition spend with negative unit economics and unclear payback.
2. **Out-of-area surcharge has never fired.** Either the 5-center expansion fully covered demand (good — fee is doing its blocking job by deterrence), or nobody from beyond the bands has tried to order (signals there's no demand spilling out of region).
3. **No post-rental revenue has ever been collected**, despite the entire pricing schedule existing in code. The oldest active install is in the 90-180-day bucket (4 installs). 6-month charges aren't due yet — but **this revenue stream is about to turn on**. If the schedule fires correctly, current pipeline will yield $0 immediately but $144 within 90 days (8 installs × $18 6mo, projected). The real question: is the cron actually wired up in prod?
4. **Median install lifetime is 35 days** — much shorter than the 6-month "free rent" window. Most installs are picked up well before any rental fee accrues. **This means the rental fee schedule won't generate meaningful revenue under current customer behavior.** It mostly catches lazy/slow-pickup edge cases. The opportunity is bigger than $18 at 6mo — it's converting the "average 35-day" stay into a **per-week or per-month flat rental from day 1** (or raising the base post install fee, since that's what people actually pay for).
5. **Expedite fee is $0 / 0 orders.** Either the option isn't exposed, or customers are using same-day scheduling without paying for it. Free option that costs Ryan labor.
6. **Wednesday/Thursday/Friday = 49 of 72 scheduled days.** Tuesday is the slowest non-weekend. **Sunday is essentially 0.** A "Sunday/Monday premium" or a "Tue–Sat only with Sun/Mon premium pricing" would route demand into clusters.
7. **Customer concentration: top 20 = 78% of revenue.** Losing Kristine Cassata or Caitlin Tudor alone is a measurable revenue dent. **There is no diversified customer base — this is a relationship business with 10-20 anchor accounts.**
8. **Top ZIP (Georgetown 40324) = 27 orders, 15% of all orders.** Strong density signal — a Georgetown-area dedicated route would have meaningful multi-stop efficiency.
9. **The broker (team_admin) feature is dormant.** Built for Peggy, used by 1 broker (Semonin), and even Semonin's 7 orders were placed by agents themselves — the bulk-placement UI generates 0 orders. The "broker volume play" assumed in the business model is not happening in the data.
10. **Sign + post bundle is 88% attach but signs net only $3.** Signs are essentially given away to support the $65 post. If signs were $5 each, that's a $2/order lift = ~$300/year at current volume, ~$3K/year at 10x.

---

## FOUNDATION DATA FOR DOWNSTREAM AGENTS

- **Total addressable revenue (current):** ~$10K/year run-rate, growing
- **AOV trend:** $48 (Mar) → $76 (June) — directional positive
- **Promo policy is the #1 lever** worth $2,834+/year at current volume
- **Labor model:** $25/hr × 2-person × ~1.5 hr round-trip-with-onsite = ~$75/order at current routing efficiency. Need AOV ≥ $80 for breakeven before supplies.
- **Customer base:** 68 paying customers, 20 anchors driving 78% of revenue, 33 one-and-done
- **Density opportunity:** Georgetown (40324) + Nicholasville (40356) + Lex SE (40509) = 49 orders alone
- **Inactive levers:** expedite fee ($0), out-of-area surcharge ($0), post-rental ($0), broker bulk placement ($0)

**Files referenced (read-only scripts created this session):**
- `c:\Users\tanne\PPI\scripts\_audit-financial-snapshot.ts`
- `c:\Users\tanne\PPI\scripts\_audit-dig-deeper.ts`