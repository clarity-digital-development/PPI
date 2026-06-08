# PPI 90-Day+ Product Roadmap — Net-New Revenue Menu

Synthesized from three research briefs. Math is grounded in PPI's actual 68-customer / ~660-order baseline. All Year-1 ARR estimates assume conservative adoption (15-35% depending on idea).

---

## TOP 10 RANKED

### 1. EDDM "Just Listed" Postcards (Click2Mail API)
- **Model:** Per-listing markup
- **Revenue:** Click2Mail cost ~$0.31/piece all-in; sell at $0.85/piece; 200-piece drop = ~$108 margin. If 20 agents do 2 drops/yr = **~$4,300/yr**. Upside: if it becomes "default add-on at install," realistic ceiling is **$8-12K/yr**.
- **Build:** ~7-10 days (Click2Mail API, address auto-fill from install record, design template picker)
- **Crew time:** Zero
- **Proof:** Wise Pelican, ProspectsPLUS!, PostcardMania all profitable in this space
- **PPI edge:** *PPI already knows the listing address the moment a sign goes up.* No other vendor has that trigger. One-click "mail 200 postcards to this carrier route" beats every competitor's manual flow.

### 2. QR-Rider Upsell at Install Checkout
- **Model:** One-time add-on
- **Revenue:** Cost $3-5, sell $15. 40% attach × 660 orders × $11 margin = **~$2,900/yr direct.** Real value: it's the entry point to #3 (lead capture) and #4 (analytics).
- **Build:** ~3 days (checkbox at checkout, inventory SKU, print partner already exists)
- **Crew time:** Zero (rider goes on the sign that's already going up)
- **Proof:** Dee Sign, A Better Sign, Square Signs all sell these as standard SKUs
- **PPI edge:** It's a checkbox, not a separate purchase. Lowest-friction upsell available.

### 3. Tracked Phone Numbers Per Listing (Twilio resale)
- **Model:** $12/mo per active listing
- **Revenue:** Twilio cost ~$2/mo; sell $12; ~$10 margin. 17 agents × 2 listings × $10 × 12 = **~$4,100/yr**.
- **Build:** ~7-10 days (Twilio number provisioning, call-log dashboard, forwarding rules)
- **Crew time:** Zero
- **Proof:** CallRail $55/mo entry; this is a deliberately stripped-down version at 1/4 the price
- **PPI edge:** Already in the install flow, listing-scoped lifecycle matches the sign's life in-ground.

### 4. Broker Analytics Tier
- **Model:** $99-199/mo subscription
- **Revenue:** 5 brokers × $149 × 12 = **~$8,900/yr**. Highest $/build-day on this list.
- **Build:** ~10-14 days (multi-tenant role, aggregate views, CSV export)
- **Crew time:** Zero
- **Proof:** BoldTrail Platform $499+/mo; PPI undercuts by 70% with narrower scope
- **PPI edge:** PPI has one active broker who is already the proof point. Broker channel also doubles as customer-acquisition wedge (each broker = 5-15 new agent seats).

### 5. QR Scan Analytics + Quarterly Sign Performance PDF
- **Model:** $9/mo Pro tier OR free retention play
- **Revenue:** If sold: 25 agents × $9 × 12 = **~$2,700/yr**. If bundled into Pro tier: justifies a $15-19/mo upsell on existing accounts.
- **Build:** ~9-11 days combined (redirect route + scan event table + PDF generator via Resend)
- **Crew time:** Zero
- **Proof:** Flowcode Pro $25/mo, Beaconstac $5/mo — proven willingness to pay for QR analytics
- **PPI edge:** PPI controls the rider, the redirect, AND the install timing. Every other QR tool is generic; this is RE-specific with hardware tied in.

### 6. Brochure-Box Refill Subscription
- **Model:** $50/mo recurring per active listing
- **Revenue:** Gelato API cost ~$25 for 50 printed flyers; sell $50/mo = $25 margin. 10 subs × $25 × 12 = **~$3,000/yr** recurring.
- **Build:** ~6-8 days (subscription SKU in Stripe, Gelato API integration, recurring print job)
- **Crew time:** Zero (drop-ships to agent or listing address; agent restocks the box)
- **Proof:** Real estate agents already pay for printed flyers; this just automates it
- **PPI edge:** Trigger is automatic from active-listing data. Subscription drops to zero margin cost after the integration ships.

### 7. Lead Capture on QR Scans (TCPA-compliant interstitial)
- **Model:** $4/captured lead OR $29/mo unlimited
- **Revenue:** 20 agents × 5 leads/mo × $4 = **~$4,800/yr**. Upside: charge $29/mo unlimited and the ceiling rises.
- **Build:** ~8-12 days (interstitial UX, TCPA double opt-in, Twilio SMS forward, lead routing)
- **Crew time:** Zero
- **Proof:** Zillow Premier Agent leads cost $20-60 in normal markets; $4/lead is a no-brainer for agents
- **PPI edge:** Direct line from physical sign → digital lead → agent CRM. *Defensible* — competitors don't own the physical artifact.

### 8. Design Your Sign (already scoped)
- **Model:** Per-sign markup on print-on-demand
- **Revenue:** Print cost ~$15-25 via 4over/Prodigi; sell $45-65; ~$25-30 margin. 25% of 660 orders attach a custom design = ~165 × $27 = **~$4,500/yr**. Upside if it becomes default: $10-15K/yr.
- **Build:** Already scoped in `docs/design-your-sign/plan.md`; estimate 3-4 weeks remaining
- **Crew time:** Zero (third-party print + ship to PPI's installer, who's already going)
- **Proof:** Canva + 4over model; Vistaprint custom signs at $40-80
- **PPI edge:** Bundles into existing install; competitors require agent to source and ship the sign themselves.
- **Rank reasoning:** Earned its spot on real margin, but it's a 3-4 week build for $4-5K/yr Y1. Click2Mail postcards are a faster ROI per dev-week.

### 9. Affiliate: Post-Install Seller Email (Bellhops moving, etc.)
- **Model:** Commission per referral ($50-200/booking)
- **Revenue:** 5% conversion × 660 listings × $150 avg = **~$5,000/yr**. Pure pass-through, zero ongoing cost.
- **Build:** ~3-5 days (Resend trigger, tracked affiliate links, simple dashboard)
- **Crew time:** Zero
- **Proof:** Bellhops, Updater, PODS all run agent-referral programs
- **PPI edge:** PPI emails the *seller* (not the agent), so RESPA likely doesn't bind. **Requires real-estate attorney review before launch.** Flag this as conditional.

### 10. Closing Gift Drop-Ship (Goody Gift API)
- **Model:** Markup per gift
- **Revenue:** 15% markup × $75 avg gift × 40 gifts/yr = **~$450/yr**. Small dollars.
- **Build:** ~4-5 days (Goody API embed, "marked sold" trigger)
- **Crew time:** Zero
- **Proof:** Client Giant ($349-1,199 packages), Knack, Greetabl
- **PPI edge:** Trigger from "sign removed = listing sold" event. Touches the agent at peak-emotion moment of the deal. Stickiness > revenue.

---

## REJECTED IDEAS

- **Matterport / drone / professional photography** — Requires a third-party photographer on site. Even as a referral, margin is low (<10%) and the referral partner owns the relationship. Not worth the integration effort.
- **Standalone AI listing description writer** — Commoditized. ChatGPT ($20/mo) and free tools (EstatePass, ListingAI) eat this category. Bundle into Pro tier as a feature, never sell standalone.
- **Open-house guest sign-in (standalone)** — Curb Hero is 100% free for solo agents. Can't compete. Bundle as free feature only.
- **CRM-light / pipeline view** — Tar pit. Building "good enough" CRM eats 6+ weeks and competes against free HubSpot + every brokerage's existing CRM. The 3-day dashboard version belongs inside #5, not as a product.
- **Direct settlement-service referrals (title, warranty, inspection, mortgage)** — RESPA §8 prohibits. First American's terms explicitly exclude RE-adjacent referrers. Don't touch this category without an attorney's blessing in writing.
- **Branded merch via Printify (mugs, totes)** — Realistic Y1 take is ~$800. Not worth a build cycle. Revisit if PPI ever opens a generic "swag store."
- **Sticker Mule integration** — No public API, no blind ship. Disqualified for automated drop-ship.
- **Door-hanger distribution** — Print is fine (drop-ship to agent). Distribution is what eats margin and isn't PPI's business.

---

## THE 3 NO-BRAINERS (ship after audit top-5)

**1. QR-Rider Upsell at Install Checkout (#2)** — 3 days of build, ships in a week, immediately lifts AOV on every existing install. This is the gateway: it has to ship before #5 and #7 make any sense. Lowest risk, fastest ROI, addresses the audit's #1 finding (AOV is too low).

**2. EDDM Postcards via Click2Mail (#1)** — 7-10 days of build for ~$4-12K/yr ARR. PPI's address-on-install-trigger is a real moat; no competitor can match the auto-fill. This is the highest-leverage *new* product line — turns one-time install customers into per-listing recurring revenue without touching the crew.

**3. Broker Analytics Tier (#4)** — 10-14 days for ~$8,900/yr ARR potential AND it's a customer-acquisition channel (each broker brings 5-15 agents). PPI already has one active broker to validate against. This is the play that materially changes PPI's unit economics from "solo realtor $55 AOV" to "broker $149/mo + agent seats."

**Why these 3, not others:** They share infrastructure (install-trigger event bus, address auto-fill, multi-tenant data model) that everything else on the list also needs. Building them first creates the foundation for #3, #5, #6, #7 to ship in half the time later. They also span all three revenue shapes (one-time add-on, per-listing markup, recurring subscription) — diversifies the revenue mix.

---

## THE OPTIONALITY PLAY

**Broker Analytics Tier (#4) is the high-upside / high-uncertainty gamble.**

- **Upside if it works:** PPI's average customer goes from $55 one-time to $149/mo recurring. 10 brokers = $18K/yr ARR + the agent seats they bring. If PPI lands 25 brokers in 24 months, that's ~$50K ARR from a single product line — more than PPI's current entire run-rate.
- **Why uncertain:** PPI has *one* broker today. The product assumes brokers will (a) want PPI's narrow data, (b) pay $99-199/mo for it, (c) be reachable through some sales channel PPI doesn't yet have. None of those are proven. The broker-channel sales motion is fundamentally different from solo-realtor self-service.
- **Why gamble anyway:** It's the only idea on this list that can 10x PPI's revenue without 10x'ing the customer count. Every other idea scales linearly with the 68-customer base. This one breaks that ceiling.
- **De-risk by:** Validating with the one existing broker before building. If they'd pay $149/mo for a v0 spreadsheet emailed weekly, build it. If they wouldn't, the product doesn't exist.

---

## THE HONEST CONSTRAINT REMINDER

PPI has **68 paying customers** and runs ~660 orders/yr at $55 AOV (~$36K run-rate). Every estimate on this list assumes 15-35% adoption. That means:

- A "huge win" subscription product = 20 agents paying $25/mo = **$6K/yr**
- A "modest" per-order add-on = 25% attach × 660 × $10 margin = **$1,650/yr**
- The entire top-10 stacked at conservative adoption = **~$40-50K/yr net new**

That doubles current revenue — meaningful — but it's not a venture-scale unlock. The real prize is **post-audit unit economics** (96% labor cost) combined with these recurring lines. Software ARR drops straight to gross margin, so $40K of new ARR on a $36K base materially fixes PPI's economics without needing to find 200 more customers.

**Don't oversell to Ryan.** The pitch is: "After the audit fixes pricing, here's a menu of $1K-9K/yr ideas. Stack 5 of them, you double the business. Don't stack one of them, you've still fixed the pricing leak and you're better off."