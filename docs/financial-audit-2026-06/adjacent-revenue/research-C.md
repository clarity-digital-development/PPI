Todo tracking isn't useful for this single-deliverable research task. Proceeding to synthesis.

---

# Researcher C — Software / SaaS / Data Products for RE Agents

**Frame:** PPI has 68 paying customers, ~96% solo-realtor mix, $55 AOV, a Next.js dashboard agents already log into, Stripe + Resend wired up, and a unique data asset (every install's address, sign type, dwell time). Software add-ons are the cleanest fit for the "no extra crew time" constraint — marginal cost approaches zero, and every line of net-new ARR drops to gross margin. Adoption assumptions below are deliberately conservative because the customer base is only three months old and concentrated.

---

### 1. QR Code Analytics Dashboard

PPI already pays nothing for QR codes (they're printed on riders). The unlock is making the scan event flow through a PPI-controlled redirect (`ppi.link/abc123` → MLS / agent site) so PPI can log scans with timestamp, geo, device. Comparable consumer tools: QR-Verse Pro €3.99/mo, Beaconstac Lite $5/mo, Flowcode Pro $25/mo, QR TIGER ~$7/mo. None are RE-specific.

- **Build:** ~5–7 days. Next.js redirect route + scan event table + dashboard chart. Reuse existing auth.
- **Pricing:** $9/mo add-on, or bundle into a "Pro" tier at $15/mo.
- **Adoption:** 35–45% of 68 = ~25 agents. RE agents over-index on "did anyone see my sign?" anxiety.
- **ARR estimate:** 25 × $9 × 12 = **~$2,700/yr.** Modest, but it's the gateway drug to #2.

### 2. Lead Capture from Sign QR Codes

Instead of dumping the scanner straight onto the MLS, present a 2-field PPI-branded interstitial ("Text me details" — phone + optional name) before redirecting. The lead is then SMS-forwarded to the agent (Twilio ~$0.0083/segment) plus emailed via Resend. Comparable economics: Zillow Premier Agent runs **$20–$60/lead in normal markets and $223 average connection cost in major metros** ([HousingWire](https://www.housingwire.com/articles/zillow-premier-agent-cost/)). PPI doesn't need Zillow pricing — a $3–5/lead "pay only for what you get" model would feel like a steal.

- **Build:** ~8–12 days (interstitial UX, double opt-in for TCPA, SMS via Twilio, lead-routing rules).
- **Pricing:** $0/mo base + $4/captured lead, OR $29/mo unlimited.
- **Adoption:** 30% = ~20 agents. Yard-sign QR scans are low-volume (maybe 2–10 leads/mo per active listing), so cap expectations. ~5 leads/mo × 20 agents × $4 = $400/mo.
- **ARR estimate:** **~$4,800/yr.** Real upside is being able to *quote* lead-gen-style economics for tier #5 brokers.

### 3. Vanity / Tracking Phone Numbers

Twilio local numbers cost ~**$1.15/mo** + ~$0.0085/min inbound ([Twilio Voice Pricing](https://www.twilio.com/en-us/voice/pricing/us)). CallRail charges agents $55/mo entry with $3/number ([CallRail pricing](https://www.callrail.com/pricing)). PPI buys numbers in bulk, prints them on the rider, forwards to the agent's cell, and records call metadata.

- **Build:** ~7–10 days. Twilio integration, number provisioning UI, call-log dashboard.
- **Pricing:** $12/mo per active listing for the tracked number + recording. Margin: $12 – ~$2 Twilio cost = **~$10/mo gross profit**.
- **Adoption:** 25% = ~17 agents, avg 2 active listings = 34 tracked numbers.
- **ARR estimate:** 34 × $10 × 12 = **~$4,100/yr.** Low effort, sticky once attached to an active listing.

### 4. Sign Performance Reports (Quarterly PDF)

Pure data product. PPI already has install date, removal date, address, sign type. Combine with #1 + #2 + #3 above to produce a quarterly "Your PPI signs: 7 active, avg 41 days in-ground, 312 scans, 18 phone calls, 4 captured leads — area average is 280 scans" PDF emailed via Resend.

- **Build:** ~4 days for v1 (HTML→PDF via Puppeteer/`@react-pdf/renderer`, cron job, Resend send). Reuses existing data.
- **Pricing:** Free for all agents (retention + upsell driver). Charge nothing — this is the "wow moment" that justifies #5.
- **ARR estimate (direct):** $0. But it dramatically lifts retention and creates a tangible reason to email every customer four times a year (which is itself a marketing channel).

### 5. Broker Analytics Dashboard

Same data, aggregated, sold to brokers. PPI's one active broker is the proof point. A broker with 12 agents wants "are my agents using the sign program effectively, what's our team scan-rate, who should I coach." Comparable: BoldTrail/kvCORE Platform tier is **$499+/mo** ([The Pro Tool Kit](https://theprotoolkit.com/boldtrail-review-2026/)) and API access is gated to Platform/Enterprise. PPI's offer is way narrower but priced to match.

- **Build:** ~10–14 days. Multi-tenant role ("broker can see all my agents' data"), aggregate views, CSV export.
- **Pricing:** $99/mo per broker (≤10 agents) / $199/mo (11–25). Plus per-seat $5/agent.
- **Adoption:** Realistic — convert the 1 active broker + recruit 3–5 more in 12 months. Say 5 brokers at $149 avg blended.
- **ARR estimate:** 5 × $149 × 12 = **~$8,900/yr.** Highest dollar leverage on this list per build-day, and the broker channel is also a customer-acquisition wedge.

### 6. Listing-Coordinator Workflow Tier

Bundles sign install + auto-scheduled removal reminder + open-house sign reservation + EDDM order (if PPI later partners with a mailer) into a "Launch a Listing" wizard. Mostly orchestration code over existing inventory + Stripe.

- **Build:** ~10 days for v1 (wizard UI, calendar-style scheduling, reminder cron). 
- **Pricing:** $19/mo "Pro" tier OR $25 launch fee per listing. Per-listing model aligns with agent's billing rhythm.
- **Adoption:** 20% = ~14 agents using launch fee on ~3 listings/yr = 42 launches.
- **ARR estimate:** 42 × $25 = **~$1,050/yr** direct. Real value is **average-order-value lift** on existing installs (every install becomes $80 instead of $55), which the audit flagged as the #1 lever.

### 7. CRM-light / Listing Pipeline View

Tempting, but **recommend deprioritizing.** Building a "good enough" CRM is a tar pit (contacts, notes, tasks, reminders, mobile…) and competes against free Curb Hero, free HubSpot, and the agent's existing brokerage CRM. The *narrow* version — "show me a timeline of every PPI sign I've had, what's currently in-ground, when each comes out, what it cost me" — is already 80% of the value and probably belongs inside #4 as a dashboard view, not a separate product.

- **Build:** ~3 days as a dashboard tab. ~6+ weeks as a real CRM. Do the 3-day version.
- **Pricing:** Free, retention play.
- **ARR estimate:** $0 direct.

### 8. AI Listing Description Writer

Comparables: ListingCopy.ai $29/mo, ChatGPT $20/mo, ListingAI free, EstatePass free ([PropTechSavant comparison](https://proptechsavant.com/best-ai-listing-description-generators/)). The category is **commoditized and racing to free.** Differentiation has to come from being *inside the install workflow* — "we already know the address, sign type, install date; click generate."

- **Build:** ~4 days. Anthropic/OpenAI API + prompt template + address-enrichment from public records if possible. ~$0.02 cost per generation.
- **Pricing:** Don't sell standalone — bundle into the "Pro" tier ($15–19/mo) as one of several perks. Quietly use as a tier-justifier.
- **ARR estimate:** $0 direct, attributable lift inside the Pro bundle.

### 9. Open-House Guest Sign-In

The competition is brutal here — **Curb Hero is 100% free for solo agents** ([Curb Hero pricing](https://curbhe.ro/)). Spacio is $25/mo solo but largely losing share to Curb Hero. PPI cannot win on features. The *only* angle: bundle it free with a paid PPI install ("our open-house sign comes with a QR sign-in built in"), which feeds leads back into #2 and bumps install AOV.

- **Build:** ~6 days (form, lead routing, branded landing).
- **Pricing:** Free with active PPI account; functions as a feature, not a SKU.
- **ARR estimate:** $0 direct. Strategic: every sign-in becomes a PPI-branded data event.

### 10. CRM Integration Connectors

Follow Up Boss, BoldTrail, Lofty, kvCORE all expose APIs (BoldTrail/kvCORE gates API to **Platform/Enterprise tiers**, per [help.followupboss.com](https://help.followupboss.com/hc/en-us/articles/360036179113-BoldTrail-Formerly-KVCore)). Most agents on PPI are solo and on Follow Up Boss ($69+/mo) or just Gmail. The connector matters most for leads from #2 — they need to land *in* the agent's CRM, not in a separate PPI inbox.

- **Build:** ~3 days per connector. Start with Follow Up Boss (best API, friendliest partner program), then Zapier-as-a-fallback for everything else.
- **Pricing:** Don't charge for it; it's the table stakes that makes #2 work. Optionally a $9/mo "premium integrations" SKU for agents who want bi-directional sync.
- **ARR estimate:** $0 direct, but **prevents churn on #2**.

---

## Ranked recommendation (for the post-audit menu)

| Rank | Idea | Build | Yr-1 ARR est. | Why this rank |
|------|------|-------|---------------|---------------|
| 1 | #5 Broker analytics | 10–14d | ~$8,900 | Highest $/build-day; doubles as broker-channel acquisition |
| 2 | #2 Lead capture + #10 FUB connector | 12–15d combined | ~$4,800 | The defensible product; data moat compounds |
| 3 | #3 Tracking phone numbers | 7–10d | ~$4,100 | Sticky per-listing recurring; Twilio resale margin is real |
| 4 | #1 QR analytics + #4 quarterly PDF | 9–11d combined | ~$2,700 direct + retention lift | Cheap, ships fast, justifies the Pro tier |
| 5 | #6 Listing-launch workflow | 10d | AOV lift ($55→$80) | Bigger as a unit-economics fix than a SaaS line |

**Combined realistic Year-1 net-new ARR if 1–5 ship: ~$20–25K** on top of current ~$55K run-rate — meaningful for a 3-month-old book and entirely without adding crew time. Critically, ideas 1–5 share infrastructure (the QR redirect + scan event table powers #1, #2, #4, #5 simultaneously), so the marginal build cost of each after the first is roughly halved.

**Skip or deprioritize:** #7 (CRM-light — tar pit), #8 (AI writer standalone — commoditized), #9 (open-house standalone — Curb Hero is free).

Sources:
- [CallRail pricing 2026](https://www.callrail.com/pricing)
- [CallRail review for real estate (RealEstateSkills)](https://www.realestateskills.com/blog/callrail-review)
- [Zillow Premier Agent cost (HousingWire)](https://www.housingwire.com/articles/zillow-premier-agent-cost/)
- [Twilio Programmable Voice pricing US](https://www.twilio.com/en-us/voice/pricing/us)
- [Twilio Phone Numbers pricing](https://www.twilio.com/docs/phone-numbers/pricing)
- [BoldTrail review and pricing (The Pro Tool Kit)](https://theprotoolkit.com/boldtrail-review-2026/)
- [Follow Up Boss BoldTrail integration docs](https://help.followupboss.com/hc/en-us/articles/360036179113-BoldTrail-Formerly-KVCore)
- [Curb Hero pricing](https://curbhe.ro/)
- [Spacio vs Curb Hero comparison](https://curbhe.ro/open-home-pro-vs-spacio-vs-block-party/)
- [Best AI listing description generators 2026 (PropTechSavant)](https://proptechsavant.com/best-ai-listing-description-generators/)
- [QR-Verse pricing 2026](https://qr-verse.com/en/pricing)
- [QR Code Generator pricing](https://www.qr-code-generator.com/pricing/)