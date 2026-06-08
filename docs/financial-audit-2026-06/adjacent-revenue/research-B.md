I have enough data to synthesize the report. Let me write it now.

---

# PPI Drop-Ship / Print-on-Demand / Partnership Revenue Menu

**Baseline:** 68 active customers (~96% solo realtors, ~$55 AOV). All ideas below add ZERO field-crew time.

---

## 1. Print Fulfillment Partners (Beyond 4over/Prodigi)

| Vendor | API | White-Label/Blind | Best PPI-Relevant SKUs | Per-Unit Cost |
|---|---|---|---|---|
| **Printful** | Full REST API ([docs](https://developers.printful.com/docs/)) | Yes — blind dropship, branded inserts | Postcards from $2.25; business cards; t-shirts; tote bags | Postcards $2.25 + $4.29 US ship |
| **Gelato** | Full API, 140+ local hubs (low ship cost) | Yes; Gelato+ at $239/yr unlocks 35% Y1 discount | Postcards, flyers, business cards, posters | Inserts/labels from $0.49; up to ~35% off w/ Gelato+ |
| **Printify** | API + Shopify/Woo integrations | Yes — blind dropship, no minimums | 11oz mugs $6.45–$8.25 base; AOP totes (40–55% margin); notebooks | Mugs sell $15–$20; totes $18–$25 |
| **Sticker Mule** | No public REST API; no blind ship (confirmed on Canny) | **Disqualifies** as direct-ship; OK for PPI-handled bulk | QR riders, sign stickers | Volume discounts only |
| **GotPrint / VistaPrint Pro** | Limited/legacy API | Partial white-label | Postcards, banners | Comparable to 4over |

**Recommendation:** Gelato is the strongest *new* partner — local hubs mean low ship cost on US postcards/flyers, and the 35% Y1 discount + no commission stacks well with PPI markup. Printify is the best catalog for branded merch (#3 below).

Sources: [Printful API](https://developers.printful.com/docs/), [Printful pricing](https://www.printful.com/pricing), [Gelato pricing](https://www.gelato.com/pricing), [Printify pricing](https://printify.com/pricing/), [Sticker Mule blind-ship Canny](https://stickermule.canny.io/features/p/blind-shipping).

---

## 2. EDDM Just-Listed Postcards (highest-upside category)

PPI already has the listing address + neighborhood data the moment a sign goes up. Agent clicks "send 500 postcards to this listing's carrier route" in dashboard, PPI submits via API.

| Vendor | Per-Piece (Print+Postage) | API |
|---|---|---|
| **Click2Mail MOL Pro API** | $0.15 print + $0.162 postage = **~$0.31 all-in** | Yes — REST + SOAP, next-day printing ([docs](https://integrate.click2mail.com/rest)) |
| **Lob (Developer plan)** | $0.77 per postcard all-in | Best-in-class API but ~2.5× Click2Mail |
| **PostcardMania** | $0.20–$0.45/piece | No public API — manual order entry; disqualifies for auto-trigger |

**Click2Mail is the clear winner.** PPI charges agent $0.75–$1.00/piece, keeps ~$0.45–$0.65 margin × typical 200-piece EDDM drop = **$90–$130 margin per listing**. If 30% of customers (~20 agents) do 2 drops/yr at $150 = **~$6,000/yr net new ARR** with literally zero crew effort. Triggerable from existing install cron.

Sources: [Click2Mail EDDM API](https://click2mail.com/by-service/mol-pro-api/eddm-mailer-6-5-x-9), [Lob pricing](https://www.lob.com/pricing), [PostcardMania EDDM](https://shop.postcardmania.com/products/just-listed-postcards-eddm-857).

---

## 3. Branded Merchandise Drop-Ship (Printify)

Agent uploads headshot + brokerage logo → PPI markets "Open House Kit" → Printify ships direct to agent.

| SKU | Printify Base | Suggested Retail | PPI Margin |
|---|---|---|---|
| 11oz ceramic mug | ~$6.45 | $18 | ~$11 |
| AOP tote bag | ~$10 | $24 | ~$14 |
| Spiral notebook | ~$8 | $20 | ~$12 |
| 24oz water bottle | ~$12 | $28 | ~$16 |

**Realistic uptake:** 15% of 68 (~10 agents) × one $80 kit/year = **~$800/yr**. Small but pure-margin. Better play: bundle a 50-piece "Open House Day" kit (mugs + branded swag) at $400 — 3 agents/yr = $1,200.

Source: [Printify pricing 2026](https://costbench.com/software/ecommerce/printify/), [Printify margin guide](https://podvector.ai/articles/printify/products/the-complete-guide-to-printifys-most-profitable-products).

---

## 4. Closing-Gift Drop-Ship

| Vendor | Model | Fit |
|---|---|---|
| **Knack (Knest)** | RE-specific gifting platform, retail-only | **Reseller path unclear** — likely affiliate only |
| **Greetabl** | Has CRM-trigger automation API ([docs](https://greetabl.com/pages/automated-gifting)) | Best API fit; integrate with PPI "marked sold" trigger |
| **Goody Gift API** | Public Gift API for embedding gifting ([docs](https://www.ongoody.com/business/gift-api)) | Strongest commerce API — embed in PPI dashboard, agent picks gift, Goody fulfills |
| **Boxfox** | Curated boxes, no public API | Manual only |

**Best fit: Goody Gift API.** Embed a "Send a Closing Gift" button on each sold listing in PPI dashboard. Avg closing gift = $50–$100; PPI markup 10–15% = $5–$15/gift. Realistic uptake: 20% of agents send 3/yr = ~40 gifts × $10 = **~$400/yr**. Low dollars but high stickiness (touches the agent at the highest-emotion moment of the deal).

Sources: [Goody Gift API](https://www.ongoody.com/business/gift-api), [Greetabl automation](https://greetabl.com/pages/automated-gifting), [Knack RE platform](https://knackshops.com/pages/real-estate-gifting-solution).

---

## 5. Affiliate / Referral Programs — RESPA WARNING

**This entire category is mostly disqualified for direct payments to PPI's *agents*.** RESPA §8 prohibits paying real estate agents for referrals of settlement services (title, mortgage, home warranty, inspection). First American's referral program *explicitly excludes* real estate agents and "persons in positions to refer settlement services."

What *is* viable for PPI specifically (PPI is not an agent, so RESPA's agent-kickback rule doesn't bind PPI for *non-settlement* services):

| Partner | Commission | Notes |
|---|---|---|
| **SentriLock (NAR)** | No public affiliate program — affiliate *membership* is $159 + $50 (a cost, not revenue) | Disqualified |
| **Master Lock Vault Enterprise** | No public partner program | Disqualified |
| **Bellhops moving (real-estate agent referral)** | Flat fee per booking | PPI could insert "moving partner" CTA at install — non-settlement, RESPA-safe |
| **Moving cos generally** | 10% local / 5% long-distance OR $50–$500 flat per booking | Same — non-settlement |
| **Lowen TradeSource** | Wholesale-to-trade pricing, *not* affiliate — PPI buys at wholesale, marks up | Already PPI's likely supplier; explore wholesale-tier discount |

**Realistic moving-referral revenue:** If PPI emails "moving day kit" to each new listing customer and ~5% book ($200 avg referral) × ~150 listings/yr = **~$1,500/yr**.

Sources: [RESPA FAQ — NAR](https://www.nar.realtor/real-estate-settlement-procedures-act-respa/respa-faq), [First American referral terms](https://refer.fahw.com/zone/terms), [Bellhops agent program](https://www.getbellhops.com/agent/), [Lowen TradeSource](https://www.lowensign.com/), [Moving referral economics](https://www.smartmoving.com/blog/moving-referral-program).

---

## 6. White-Label SKUs PPI Could Bundle Into Existing Installs

These get added to the install workflow at order-time, no extra truck visit:

| SKU | Source | Cost | Retail | Margin |
|---|---|---|---|---|
| **QR-code rider** (weatherproof BOPP, custom to listing URL) | Dee Sign / Oakley / PrintSignsQuick | $2.75–$5 | $15 add-on | ~$10 |
| **"Open House This Sunday" rider** (pre-printed stock) | Lowen wholesale | ~$3 | $12 | ~$9 |
| **Brochure-box refill subscription** (printed flyers re-stocked monthly) | Gelato API | $0.50/flyer × 50 = $25 | $50/mo subscription | $25/mo recurring |
| **Custom directional arrow signs** | 4over / Lowen | ~$8 | $25 each | ~$17 |
| **Premium rider 2-pack upsell** at checkout | Existing inventory | n/a | +$20 add-on | ~$15 |

**The QR rider is the no-brainer.** PPI already knows the listing URL. Add a $15 checkbox at install checkout. 40% attach rate × 150 installs/yr × $10 margin = **~$600/yr** — small per unit but stacks with the install with literally zero new ops.

Sources: [Dee Sign QR riders](https://www.deesign.com/qr/), [PrintSignsQuick riders](https://www.printsignsquick.com/sign-rider), [Lowen Sign](https://www.lowensign.com/).

---

## Revenue Stack — Combined Ceiling (Year 1, Conservative)

| Stream | Annual Net |
|---|---|
| EDDM postcards via Click2Mail | **$6,000** |
| QR-rider + premium add-ons at install | $600 |
| Brochure-box refill subscriptions (10 subs × $25 × 12) | **$3,000** |
| Branded merch (Printify) | $800 |
| Closing-gift drop-ship (Goody) | $400 |
| Moving referral (Bellhops) | $1,500 |
| **TOTAL Y1 net add** | **~$12,300** |

That's roughly **+125% of current ARR** with zero added crew labor. The top-two drivers (EDDM + brochure-refill sub) are both **automation-of-data-PPI-already-has** plays — the listing address triggers a print job, no human decisions required after the agent's one-time opt-in.

**Recommended sequence after audit top-5 ships:** (1) Click2Mail EDDM integration → (2) brochure-refill recurring sub → (3) QR-rider checkout add-on → (4) Goody Gift API embed → (5) everything else.