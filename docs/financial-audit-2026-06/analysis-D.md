I have all the data I need. Now writing the brief.

---

# CUSTOMER SEGMENTATION — what the 68 paying customers actually look like

**Data: 177 paid orders, 68 paying customers, $9,769.43 lifetime revenue. Read-only pull at 2026-06-08.**

Before getting into Pareto math, one frame the rest of this document depends on: **using a realistic per-order labor model (~$129/order — 2-person crew, 30 min one-way drive each direction, install + pickup), 67 of 68 paying customers are negative-margin.** The only positive-margin customer in the entire database is Derrick Plunkett (3 orders, $552, AOV $184). Every other customer including the top-revenue ones costs more in labor than they generate in revenue. This isn't a "fire the bad customers" problem — it's a structural pricing/density problem that masquerades as a customer-segment problem. With that caveat, the segments still matter because they tell you which levers move the needle.

---

## 1. Pareto — concentrated, but not the textbook 80/20

| Slice | Customers | Revenue | % of Rev | Orders | % of Orders |
|---|---:|---:|---:|---:|---:|
| Top 20% | 14 | $6,281.97 | **64.3%** | 89 | 50.3% |
| Bottom 20% | 14 | $34.58 | 0.4% | 14 | 7.9% |

It's a 64/20, not 80/20 — but expressed differently it gets sharper:

- Top 5 customers = **32.2%** of revenue
- Top 20 customers = **78.3%** of revenue
- Bottom 33 customers (one-and-done) = **5.4%** of revenue and **18.6%** of orders

The bottom 20% isn't expensive in drive time (14 orders = ~7.9% of crew effort), so the textbook "fire the bottom 20%" play doesn't recover much. **The real revenue concentration story is top 20 anchors carrying 78% — losing any one of them is felt immediately.**

---

## 2. Segment margin — broker channel is dormant, solo dominates

| Segment | Customers | Orders | Revenue | AOV | Rider attach | Lockbox attach | Est margin/order |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Solo realtors** (no team) | 67 | 170 | $9,363.12 (95.8%) | $55.08 | 35.3% | 12.9% | $-74.09 |
| **Brokers** (team_admin) | 1 | 7 | $406.31 (4.2%) | $58.04 | 0.0% | 14.3% | $-71.12 |
| **Broker agents** (customer + teamId) | 0 | 0 | $0 | — | — | — | — |

**Three observations:**

1. **The "broker volume channel" doesn't exist yet.** Two teams are in the database — Semonin Realtors and Ryan's Test Team. Semonin has 9 agents on the managed roster but only 1 login account (`supportstaff@semonin.com`), and that account placed 7 orders directly (no `placedByUserId` indirection). **The bulk-placement-by-broker flow that Ryan built has generated $0.** Zero of 177 orders have `placedByUserId` set.
2. **The brokerage perks are giving away margin for almost no volume.** Semonin's `freeLockboxInstall = true` plus team_admin's out-of-area exemption is costing real money for **4.2% of revenue**. That's a bad trade in the current state.
3. **Solo realtor AOV ($55) is materially lower than the breakeven AOV (~$80+).** Brokers aren't even higher AOV than solos. The "broker = volume + lower per-order margin is OK" thesis isn't materializing.

---

## 3. Unprofitable patterns — the real money is in promos, not "bad" customers

### One-and-done: 33 customers (48.5% of base)

| Sub-segment | Count | Avg revenue/customer | Est. labor/customer | Net |
|---|---:|---:|---:|---:|
| Acquired via promo (TOOCOLD/SAVETIME) | 26 | $2.47 | $129 | **-$126.50 each** |
| Paid full price, never returned | 7 | $65.62 | $129 | -$63 each |

The 26 promo one-and-dones are **the single largest customer-segment leak in the dataset**: ~$3,289 in labor spent on customers who paid $64 total. If Ryan wanted a marketing campaign with that budget he could've gotten better than 0 retention.

The 7 full-price one-and-dones aren't a problem to fix — they're an unavoidable cost of a young business. Some will come back.

### Hard customers (excess service requests)

Only **1 customer** has service requests > orders: cheri shaffer (1 order, 2 SRs, $2.47 promo). Not a meaningful pattern. PPI does NOT have a "hard customer" problem — service requests are well-distributed.

The bigger SR signal is in **Semonin Broker Account: 7 orders, 6 service requests.** That's 0.86 SR per order vs ~0.25 for solos. Broker-side accounts generate more touch points per install — relevant when pricing the broker channel.

### Promo recipients who DID convert

Of 41 promo users, **15 came back and paid full price** (avg lifetime $173). That's a 37% conversion rate from promo to paid-customer — not great, not terrible. **15 retained customers × $173 LTV = $2,591 total value vs ~$2,834 promo cost. Break-even on customer-acquisition spend.** The promo wasn't a disaster as marketing; it was a disaster as discount policy because there was no follow-up offer to convert promo → paid.

---

## 4. Broker economics — the Peggy thesis isn't proven yet

Looking at the only real broker in the system:

- **Semonin team**: 1 login account, 9 managed agents on roster, **7 orders total ever** placed by the broker login, **0 placed via the team_admin bulk flow** (no `placedByUserId` in any of them)
- **AOV $58** — not higher than solos
- **Service requests 6 vs orders 7** — significantly higher operational load
- **Perks consumed**: out-of-area exempt + free lockbox install — neither has triggered any actual fee waiver (because no Semonin order hit the surcharge band, and lockbox attach is only 14%)

**Recommendation on the Peggy/broker model:** the perks aren't costing Ryan today because volume isn't hitting them — but the broker discount/exemption structure is sized for a 50-orders-per-month broker, not a 7-orders-total broker. **Before extending more brokers, pull the perks back to: (a) flat 5% volume discount unlocked at 10 orders/month, (b) out-of-area surcharge billed at $25 (half rate) instead of waived entirely, (c) lockbox install free only on broker-owned lockboxes that PPI already stores.** Test the model on Semonin first before signing the next broker.

---

## 5. Churn — too young to measure, but two anchors are quiet

Customers with **3+ lifetime orders who haven't ordered in 45+ days**: only **2** — Kim Fister (5 orders, last 51d ago) and cindy walker stuart (4 orders, last 75d ago). Combined $534 of historical revenue. Worth a 10-minute call from Ryan each to ask "how's the season treating you, anything we can do?"

**Active anchors (3+ orders AND last order ≤45d)**: 20 customers carrying **$7,428 (76% of all-time revenue)**. **This is the actual customer base.** Losing 2-3 of these 20 is a measurable revenue cliff.

---

## 6. CAC — instrument it, you're flying blind

PPI has no UTM/source/referral_source field on User. Cannot compute CAC. Looking at email-domain clustering for indirect signal:

- **Office-domain clusters** (multiple agents from same brokerage email): Semonin (3 agents, $1,115), Indigo & Co Realty (3 agents, $1,437 — Kristine + Nicole = the #1 and #7 customers!), KW (6 agents, $275), Better Homes Garden KY (1), Keller Williams Commercial (1)
- **Pattern**: when one agent in an office uses PPI and likes it, more from that office follow. Indigo & Co is the strongest signal — **2 of top 7 customers come from the same brokerage**, suggesting word-of-mouth within offices is the dominant acquisition channel.

**Recommendation:** add a one-field `acquisitionSource` enum to User on signup (referral / google / brokerage_word_of_mouth / direct). The 1-line addition lets the next 6 months of data actually answer this question.

---

## 7. RECOMMENDATIONS BY SEGMENT

### Anchor customers (top 20, 78% of revenue) — **invest more**
- Concierge tier: priority same-day scheduling + dedicated text-line + 5% loyalty discount at 20 lifetime orders. Cost is near zero; retention insurance for 76% of revenue.
- Hand-written or personal-email check-in from Ryan every 90 days to the top 10. Real-estate is a relationship business.
- **Specifically focus on Indigo & Co Realty (Kristine + Nicole + 1 more, $1,437 combined)** — if there are 5 more agents in that office, that's the highest-yield prospecting target in the data.

### Promo recipients (41 customers, 26 one-and-dones) — **convert or write off**
- One-time email to all 26 one-and-done promo users: "Welcome back — first paid order at $10 off." If even 5 of 26 convert, that's $325+ revenue and 5 new measurable LTVs. If 0 convert, you have data confirming the channel is dead and you stop discounting.
- **Stop running 100%-off promos**. The $2.47 fuel surcharge is not customer acquisition cost — it's a $129 labor loss per acquisition. Replace with a "$25 off first order" cap that limits exposure to ~$25/customer instead of ~$129.

### Solo realtors (95.8% of revenue, $55 AOV) — **raise AOV**
- The 35% rider attach and 13% lockbox attach are the leverage. Every 1% increase in lockbox attach at this volume = ~$3 revenue but **lockboxes are owned inventory with near-zero marginal cost** — pure margin.
- A/B test: surface "add a lockbox: $5" in the post-install email instead of at checkout. Cheap to try.
- Brochure box attach is 1.7% — kill it from the catalog UI unless someone is asking for it. It clutters the conversion path.

### Brokers (Semonin only, 4.2% of revenue) — **renegotiate before expanding**
- The current broker package was designed for high volume that never materialized. Talk to Semonin's supportstaff contact about why the bulk-placement flow isn't being used (UX problem? Workflow problem? Don't know it exists?). Fixing that flow could 5x their order volume with no labor change to PPI.
- **Do not sign Peggy or any next broker on the current perk structure.** Tier it: standard perks unlock at 10 orders/month; out-of-area waived only above 25 orders/month.

### Quiet anchors (Kim Fister, cindy walker stuart) — **call them**
- 10-minute phone call from Ryan this week. Low effort, retention insurance, gathers ground truth.

### Bottom 33 customers (one-and-dones, 5.4% of revenue) — **leave alone, instrument signup**
- They're not the problem. Don't waste energy. Use the slot to add referral attribution to the signup form so the next 33 one-and-dones produce data instead of just churn.

---

**Files:**
- `c:\Users\tanne\PPI\scripts\_audit-customer-segmentation.ts` (read-only analysis script, new)
- `c:\Users\tanne\PPI\scripts\_audit-financial-snapshot.ts` (prior session)
- `c:\Users\tanne\PPI\scripts\_audit-dig-deeper.ts` (prior session)