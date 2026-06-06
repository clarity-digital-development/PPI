# Design Your Sign — Feasibility & Build Plan

**For:** Ryan
**From:** Tanner
**Date:** 2026-06-05
**Status:** Recommendation pending go/no-go

---

## 1. Executive Summary

**Recommendation: Build it. Ship a tightly-scoped MVP in ~4 weeks.**

The core idea is sound: real estate yard signs are genuinely broken (decorative fonts, brokerage logos that dominate over the agent's phone number, low-contrast luxury palettes that disappear at 30mph), and there's no incumbent solving it with a programmatic, agent-self-serve flow. The research is unambiguous on what a high-converting sign looks like — it's a small set of rules (≤5 info elements, ≥6" phone number, ≥4.5:1 contrast, sans-serif bold) we can enforce in code. Print fulfillment is a solved problem via 4over's API (≈$5–10/sign at reseller wholesale, 1–3 day production, blind dropship). Image generation costs ~$0.06–$0.30/sign — a rounding error vs. print/ship.

**The non-obvious finding:** Tanner's "RAG for image models" framing is the wrong question. We should NOT ask the image model to design the sign. Every production design tool (Canva, Looka, Vistaprint) handles this the same way — AI generates the unconstrained parts (backgrounds, mood, style); deterministic code renders the constrained parts (phone number, name, license #, EHO logo). A 1% text-rendering error rate from gpt-image-2 is unshippable on a printed sign — one wrong digit in a phone number is a refund event. The hybrid architecture (LLM-planner → image-model-background → SVG-composited typography → OCR-validated → admin-approved → print) is the only path that hits print-grade reliability.

**Bottom line for the P&L:** All-in cost per sign ≈ **$18–$30** (~$0.30 AI + $8 print + $12–15 ship/install allocation). Retail at **$129–$179** to agents. Gross margin ~80%. We don't need volume for the unit economics to work — we need volume to amortize the ~4 weeks of build. Break-even at ~30 signs sold. **Confidence: high on feasibility, medium on adoption** (agents are conservative buyers; the pitch has to be "your current sign doesn't convert" not "AI-designed sign").

---

## 2. The Problem

Real estate yard signs are a $hundreds-of-millions/year category that operates on intuition and vendor marketing, not evidence. The result is signs that look fine standing next to them and fail their actual job — being read from a moving car.

**What the data says:**

- **Yard signs are a declining but still-meaningful channel.** ~8% of buyers find their *home* via yard signs (vs. 51% online). Signs are not the primary lead-gen channel anymore — but they ARE the agent's primary outdoor branding surface in their farm area. The pitch isn't "more leads from signs" — it's "your sign is the cheapest billboard you own, and right now it's broken."
- **The "drive-by readability" failure is measurable, not subjective.** USSC research (the standards body for signage) sets the rule at **1 inch of letter height per 10 feet of viewing distance**. A passing driver is ~30 ft from a curbside sign — meaning phone numbers must be **at least 3" tall just to be readable**, and **~6" tall to be readable comfortably while driving**. Most current RE signs have phone numbers in the 1–2" range, dwarfed by the brokerage logo.
- **The cognitive load ceiling is hard.** FHWA driver-reaction research: drivers process 4-element signs in 1.3 seconds, 9-element signs in 2.2 seconds. Most current RE signs cram in 8–11 elements (agent name, photo, phone, email, website, brokerage logo + tagline, license #, "For Sale," QR code, riders) — exceeding the processing window. **Result: drivers retain nothing.**
- **Lead conversion across all RE channels averages 2.4%.** No peer-reviewed data on calls-per-sign-per-month exists. The industry runs on vendor anecdotes. This is actually an opportunity — PPI could be the first to run real A/B tests across our customer base.

**The honest pitch to agents:** "You're paying $30–60 for a sign that violates basic legibility rules. Ours costs $129, follows the research, and you'll have it in 5 days."

---

## 3. What Winning Signs Look Like

These are the rules our system bakes in. Every generated sign must pass all of them or it doesn't go to print.

**Visual hierarchy (largest → smallest, non-negotiable order):**

1. **Headline** ("FOR SALE" / "JUST LISTED" / "JUST SOLD") — top band, ~15% of canvas height
2. **Phone number** — second-largest element, ≥6" tall on 24×18 sign, formatted with hyphens (`859-555-0142`, not parentheses)
3. **Agent name** — third-largest, sans-serif bold
4. **Brokerage name** — must be present per state regs, but never larger than the phone number
5. **License # + EHO logo + QR code** — compliance band at bottom

**Design rules baked into the generator:**

| # | Rule | Why |
|---|---|---|
| 1 | Sans-serif bold fonts only (Helvetica, Futura, Proxima Nova, Impact) | Serifs blur at distance |
| 2 | ≤5 distinct information elements total | FHWA 2.5-second processing window |
| 3 | ≤3 colors on the canvas | Reduces visual noise |
| 4 | ≥4.5:1 WCAG contrast ratio text-to-background | Outdoor legibility |
| 5 | Approved high-contrast color pairs only (black/yellow, black/white, white/navy, white/red, white/dark-green) | Tested in sun, dusk, overcast |
| 6 | ≥30% whitespace | Crowded signs read as noise at distance |
| 7 | Headshot ≤25% of canvas, left-third placement | Z-pattern eye scan |
| 8 | QR code minimum 1.5" square, with value-prop microcopy ("Scan for home value") | Bare QRs get ~0 scans |
| 9 | Phone number chunked with hyphens | Faster recall at a glance |
| 10 | One CTA only (Call OR Scan, never both equally weighted) | Two CTAs split attention |
| 11 | Brokerage full legal name required (state regs) | KY/IN/TN/OH compliance |
| 12 | EHO logo present, sized correctly (federal requirement) | HUD compliance |

Brokerage brand colors (KW red, CB blue, RE/MAX red/white/blue, C21 gold/black) are honored as background/logo only — text is always rendered in the brand-approved high-contrast pair.

---

## 4. The Product

**Where it lives:** `/dashboard/design-sign` — accessible from the existing agent dashboard, gated to authenticated agents only.

**The input form (single page, 5 sections):**

1. **State of licensure** (KY/IN/TN/OH dropdown) — loads the right compliance config
2. **Personal info** — first name, last name, phone, email, license #, optional vanity URL
3. **Brokerage** — brokerage name (autocomplete from franchise list: KW, CB, RE/MAX, C21, Compass, Independent), brokerage license # if applicable
4. **Headshot upload** — required for headshot templates, optional otherwise. Auto-runs background-removal so the agent doesn't need to do it.
5. **Style preference** — 3 visual choices: Classic (high-contrast, blocky), Modern (clean, minimal), Luxury (typography-driven, no photo)

**The preview flow:**

- Form submission triggers backend pipeline: LLM-planner picks a layout archetype + colors → image model generates background → SVG compositor renders the real text → OCR validator confirms text accuracy → preview displayed.
- Agent sees the rendered preview in ~10–15 seconds.
- **Regenerate budget: 3 free regenerations.** After that, each regen costs $1 to discourage abuse and keep our image-API costs bounded.
- Agent can toggle between the 3 style choices without re-running the image model (cached backgrounds, just re-composite).

**Approval / print order:**

- Agent clicks "Approve & Order" → standard PPI checkout flow (Stripe).
- **Order goes into an admin review queue** (human gate) before print fires. This is the v1 safety net — Tanner or an ops person eyeballs every sign for the first ~200 orders to catch edge cases the OCR validator misses. We remove the human gate once we have confidence data.
- Admin approves → backend POSTs to 4over API with the PDF → 4over prints + blind-ships to the installer.

**How it slots into existing PPI inventory:**

- New row in `CustomerSign` table with `sourceType = 'custom_designed'`.
- New `SignDesign` table stores: prompt, model name, seed, generated background URL, SVG template ID, agent inputs JSON, OCR validation result. Enables reorder ("send me 5 more of the same sign next month") without re-running the AI.
- New `PrintOrder` table holds vendor + external order ID + tracking number, plumbed through to the existing PPI order tracking UI.
- Sign is added to the customer's PPI inventory the moment 4over reports it shipped. From there it flows through the existing install/dispatch/inventory infra unchanged.

---

## 5. The Engineering Architecture

**Tanner's question, honestly answered:** "How do we apply RAG to an image model so it understands high-conversion design?"

**Short answer: we don't, because that's the wrong question.** RAG (retrieval-augmented generation) works for LLMs because text models can read and reason over retrieved context. Image models can't. You can't hand gpt-image-2 a PDF of FHWA legibility research and expect it to honor a 6" font-height rule. Image models generate pixels from a prompt; they have no concept of "the phone number must be 220 pixels tall."

**The right framing:** separate the **design decisions** (which the LLM is great at, given a knowledge base) from the **pixel generation** (which the image model is good at within constrained scope) from the **typography** (which deterministic code is perfect at).

**The chosen architecture (4 stages):**

```
Stage 1: LLM PLANNER (gpt-5 / claude-opus-4.7)
  Inputs: agent form data + design rules KB (the 12 rules above,
          stored as TypeScript constants — not a vector DB)
  Output: DesignSpec JSON
          - which layout archetype (A/B/C/D)
          - which color pair from approved list
          - exact font sizes for each element
          - background prompt for the image model
  → This is the "RAG" step, except the KB is structured rules, not
    retrieved documents. Same outcome, simpler infra.

Stage 2: IMAGE MODEL (gpt-image-2 or Ideogram 4.0)
  Input: background prompt only — never the agent's name, phone, etc.
  Output: 1800×2400 background image, no text
  Cost: ~$0.06–$0.21 per generation
  → The model does what it's actually good at: textured, on-brand
    backgrounds. It never touches the load-bearing typography.

Stage 3: SVG COMPOSITOR (satori or @resvg/resvg-js, already
         common in Next.js)
  - Place background image
  - Place uploaded headshot (background-removed, color-graded
    to match background palette)
  - Render real text at spec'd sizes using approved fonts
  - Compose EHO logo, QR code, compliance band deterministically
  → Output: vector PDF, any DPI the print vendor wants.
    Phone number is byte-perfect every time.

Stage 4: OCR VALIDATOR (Tesseract)
  - Read all text on the final composited image
  - Diff vs. DesignSpec
  - Reject if phone/name/license mismatch
  → Catches bugs before print. Tesseract on clean,
    high-contrast text we control hits 99%+ accuracy.
```

**Why this beats every alternative we evaluated:**
- Full end-to-end AI (just prompt the model) — 5–10% of signs ship with typos. Unshippable.
- Pure template-based (no AI) — every sign looks identical. No differentiation vs. existing vendors.
- Fine-tuned image model — $5–20K training cost for marginal improvement over hybrid.
- True image-RAG (CLIP-embed a corpus of good signs) — adds infra we don't need; the structured KB does the same job.

**What we're betting on:** that agents perceive the AI value as "this sign was designed for me with my photo and brokerage" — not as "an AI image generator made this." Since the AI part is only the background texture and the typography is real designed text, the output will look like a designed sign, not an AI artifact.

---

## 6. Print Partner

**Primary: 4over.** They check every box: public REST API with HMAC-SHA256 auth, 4mm/10mm Coroplast (RE industry standard), reseller-tier wholesale pricing, blind-dropship as a first-class feature, US factory footprint, 1–3 day production.

- **Per-sign cost:** ~$5–10 at reseller wholesale (single 18×24 Coroplast), dropping to ~$2.50 at qty 100+. Exact tier requires a sales call once the reseller cert is approved.
- **Turnaround:** 1–3 business days production + standard ground ship.
- **Gotcha:** Reseller approval requires a valid state resale cert and ~1–2 weeks of paperwork. Start this in week 1 in parallel with development.

**Fallback / fast-start: Prodigi (Pwinty API).** Best documented REST API of any vendor surveyed. No reseller-cert gate — sign up and ship today. **Hard constraint:** metal yard signs only, no Coroplast.

**Recommended path:** Build and ship the entire end-to-end flow on **Prodigi** in weeks 1–2 so we don't block on 4over paperwork. Once 4over approval clears, swap the default vendor to 4over via the `PrintVendor` adapter pattern. Keep Prodigi available as a "premium metal sign" upsell tier ($229–$279) — metal signs are genuinely premium, last longer, and justify the higher unit cost.

**Why not Dee/Lowen/Oakley** (the RE-native specialists): no public API. Dee's quoted turnaround is 10–15 business days, which destroys the agent UX. Worth a sales call to Lowen as a v2 conversation — if they'll commit to API access at volume, they become the long-term ideal partner because their templates include franchise-brand compliance natively.

---

## 7. Cost + Pricing Model

**Per-sign cost to PPI:**

| Line item | Cost |
|---|---|
| LLM planner (gpt-5 / claude-opus) | ~$0.02 |
| Image model (gpt-image-2 background, ~3 regens avg) | ~$0.18 |
| Headshot background removal (cached forever) | ~$0.10 |
| 4over print (18×24 Coroplast, single, reseller tier) | ~$8.00 |
| Ground ship to installer warehouse | ~$4.00 |
| Install allocation (existing PPI cost) | ~$10.00 |
| Stripe fees (~3%) | ~$4.00 on $129 |
| **Total COGS per sign** | **~$26.30** |

**Suggested retail pricing:**

| Tier | Product | Price | Margin |
|---|---|---|---|
| Standard | 18×24 Coroplast, AI-designed, installed | **$129** | ~80% |
| Premium | 18×24 Metal (Prodigi), AI-designed, installed | **$229** | ~75% |
| Reorder | Identical reprint, no AI regen | **$79** | ~85% |

**Comparison to existing PPI sign costs:** stocked "For Sale" signs in current PPI inventory run roughly $40–60 retail at thinner margins. The custom design tier sits above that, in line with what RE-native vendors (Dee, Oakley) charge for custom signs (~$100–180), but with faster turnaround and the differentiated "designed for conversion" positioning.

**Break-even on build investment:**

- Build cost: ~4 engineering weeks at Tanner's blended rate ≈ $15–25K of opportunity cost
- Gross profit per standard sign: ~$103
- **Break-even at ~30 standard signs sold** — achievable in month 1 if we put it in front of the existing PPI customer base
- 100 signs/month at $129 = $10,300/mo gross profit = ~$124K/yr at steady state

**Sensitivity:** if image-model costs double or print costs rise 30%, COGS goes to ~$32 and margin to ~75% — still healthy. If 4over reseller pricing comes in at $5/sign instead of $8, COGS drops to ~$23 and margin to ~82%.

---

## 8. MVP Scope

**v1 (ship in ~4 weeks):**

- Single image model (gpt-image-2 for premium quality; Ideogram 4.0 as a cost lever if API spend climbs)
- Single print partner (Prodigi for week 1 launch; 4over swap-in once approved)
- **4 locked layout archetypes** (designer-tuned SVG templates): A) headshot-left + stacked text, B) headshot-bottom-right + text-top-left, C) no-headshot + brokerage-dominant, D) photo-of-property + agent strip
- **3 locked style choices** (Classic / Modern / Luxury) — these constrain the background prompt
- 1 sign size (18×24 Coroplast standard)
- KY compliance config only (we're KY-primary; OH/IN/TN agents see a "coming soon" gate)
- 3-regen budget, $1 per additional regen
- **Admin review queue** — every order eyeballed before print fires
- Reorder flow (same design, no AI regen, $79)
- Single CustomerSign + SignDesign + PrintOrder schema additions

**v2 (defer):**

- Agent self-serve design freedom (color overrides, font choices)
- Multi-template variants (more than 4 archetypes)
- Automated compliance checks per state (lift the human review gate)
- Multi-state rule sets (OH/IN/TN configs)
- A/B testing harness — randomized variants shipped to similar agents, measure call volume via tracked phone numbers
- Metal sign upsell tier (Prodigi alongside 4over)
- Brokerage-bulk ordering (KW brokerage orders 50 signs for new agents)
- Image-RAG over a corpus of high-converting historical signs (revisit after 200+ shipped signs with conversion data)

---

## 9. Effort, Timeline, and Risks

**4-week build plan:**

| Week | Work |
|---|---|
| 1 | 4over reseller application submitted. Prodigi sandbox integration. New Prisma schema (`CustomerSign.sourceType`, `SignDesign`, `PrintOrder`). LLM-planner with structured output + design-rules KB. |
| 2 | Image-model integration (gpt-image-2 background-only). SVG compositor with the 4 archetypes. Headshot pipeline (upload, bg-remove, color-grade). Stripe checkout flow plumbing. |
| 3 | OCR validator. Admin review queue UI. Agent intake form + preview UI + regen budget. End-to-end Playwright tests for the happy path + 3 failure modes. |
| 4 | Polish, edge cases (failed OCR, failed print API, refund flow). Internal QA on ~20 test signs. Soft launch to 5 friendly agents. |

**What could go wrong (and what we do about it):**

| Risk | Mitigation |
|---|---|
| **Image model produces unusable backgrounds** (text bleeding through, wrong style) | OCR validator catches text leakage. Agent regen budget covers stylistic misses. Fall back to a curated "no-AI background" texture library after 3 failed regens. |
| **Print errors at 4over** (color shift, misaligned crop) | Soft pilot with 4over before going live. Maintain a CMYK-converted preview the agent sees in the approval step — what they see is what they get. |
| **Agent self-design abuse** (offensive content, competitor branding) | Admin review queue catches it in v1. Content moderation on the LLM-planner output in v2 (block competitor brokerage names, profanity, etc.). |
| **State compliance violation slips through** | KY-only in v1. Compliance fields rendered deterministically by code, not the LLM. Brokerage legal name + license # + EHO logo are template-required, not optional. |
| **Headshot quality degrades the sign** (low-res, bad lighting, casual photo) | Auto-reject uploads below 800×800 px or with non-portrait aspect ratios. Show the agent an example "good vs. bad" headshot at upload. |
| **4over reseller approval delays past week 4** | Launch on Prodigi metal-only as the "premium tier" pilot; swap in 4over Coroplast as the standard tier when approved. Adapter pattern makes this a config change. |
| **Cost overruns on image API** (agents regen 20×) | Hard 3-free + $1/regen ceiling. Backend rate-limits to prevent automation abuse. |
| **Low agent adoption** | Pitch to the existing PPI customer base first — they're a captive audience with a real pain point. Track conversion rate; if < 10% of customers shown the offer take it up, revisit positioning before scaling spend. |

**Honest call:** the engineering risk is low because every component is well-trodden (Next.js + Prisma + Stripe + LLM API + image API + Tesseract + SVG compositor are all standard tools). The real risk is adoption. We should build the MVP, but with a tight feedback loop on the first 50 orders before investing in v2 features.

---

## 10. Appendix — Condensed Source Research

### A. Conversion data (Researcher A)

- NAR 2025 Profile of Home Buyers and Sellers: 88% of buyers used an agent; 91% of sellers used an agent; 66% of sellers found their agent via referral.[^1][^2]
- ~8% of buyers attribute home discovery to yard signs / open house signs combined.[^3] 51% find their home online; 100% of recent buyers use the internet during search.[^4]
- Industry-wide RE lead conversion: 1.8–4.6%, ~2.4% average.[^6]
- USSC Legibility Index = 30: 1 inch of capital letter height ≈ 10 ft readable, 30 ft max. Research conducted by Penn State Transportation Institute.[^7][^8][^9]
- "Readable" ≠ "visible" — visibility extends 3–10× further.[^9]
- At 30 mph, 8" letters visible for 1.8 sec; at 60 mph, 0.9 sec.[^10]
- FHWA driver-reaction research: 1.3s for 4-element signs, 1.6s for 6-element, 2.2s for 9-element.[^11]
- Color: black-on-yellow, black-on-white, white-on-dark-blue rank highest. ≥70% text-background contrast recommended.[^12][^13]
- QR with value prop: 13.6% scan-to-lead in a single agent case study (vendor-sourced, treat as anecdotal).[^14]
- No controlled A/B study of RE yard sign designs exists. Opportunity for PPI to run the first.

### B. Design best practices (Researcher B)

- Bold sans-serif only (Helvetica, Arial, Futura, Gotham, Proxima Nova, Impact).
- 1"/10ft rule → 6" phone number on 18×24 sign for 30mph readability.
- Stroke weight 12–15% of character height. Tracking +20–40 units on headlines.
- Hierarchy: FOR SALE > Phone > Agent name > Brokerage > License # > EHO. Phone never smaller than brokerage logo.
- ≤3 colors, ≥4.5:1 WCAG contrast, ≥30% whitespace.
- Landscape 24×18 industry standard. Z-pattern eye scan (not F-pattern).
- Headshot: left third, ≤25% canvas, ≤33% max, neutral background.
- QR code lower-right, ≥1.5" square.
- Compliance: KY 201 KAR 11:105 (full brokerage name required, license # recommended), IN 876 IAC 8-1-8 (brokerage name required), TN TCA 62-13-309 (firm name required), federal HUD EHO logo required and sized ≥ largest other logo.
- Brokerage brand palettes (KW red, CB blue, RE/MAX, C21 gold/black) honored as background/logo only; text always in the approved high-contrast pair.

### C. Image model capabilities (Researcher C)

- gpt-image-2 (April 2026): $0.21/high-quality 1024×1024, max 3840×2160, supports masking and 16 reference images. Claimed 99% text accuracy — at 6 elements per sign, sign-level success = 94%, i.e., 1 in 17 ships with typos.
- Ideogram 4.0: $0.03–$0.10, ~90–95% text, 2K native, character reference.
- Recraft V3: $0.04 raster / $0.08 vector — only model with native SVG output.
- Imagen 4: $0.02–$0.06, strong text.
- 24×18 at 300 DPI = 38.9 MP, ~4.7× over gpt-image-2's native ceiling. 150 DPI acceptable for yard signs (viewed from 5+ ft).
- Recommendation: hybrid (AI background + programmatic text). Image gen is <2% of COGS — optimize for quality, not API cost.

### D. Print partners (Researcher D)

- **4over** (primary): public REST API w/ HMAC-SHA256, 4mm/10mm Coroplast, ~$5–10/sign reseller, 1–3 day production, blind dropship. Requires state resale cert + 1–2 week approval. No first-party RE templates.
- **Prodigi/Pwinty** (fallback): best-documented REST API, no approval gate, metal-only for yard signs (no Coroplast). Good as a fast-start + premium upsell tier.
- **Dee/Lowen/Oakley** (RE-native): right product, RE-specific templates including franchise compliance, but **no public API**. Dee 10–15 day turnaround disqualifies. Lowen worth a v2 sales call.
- **In-house printing**: ~$120K capex + 1 FTE. Revisit at >5,000 signs/month — years out.

### E. Engineering / prompting strategy (Researcher E)

- Naive prompting fails: 5% text-render defect rate is unshippable; layout instability across regens; non-determinism on identity (headshot drift).
- All production design tools (Canva, Looka, Vistaprint) use template + variable-data fill, not raw text-to-image, for finished output.
- Chosen architecture: LLM-planner (structured DesignSpec JSON) → image model (background only, no text in prompt) → SVG compositor (satori or @resvg/resvg-js) for real typography → Tesseract OCR validator → admin approval → print.
- "RAG" step is a structured rules KB (TypeScript constants), not a vector DB. Image models don't benefit from semantic retrieval.
- True image-RAG (CLIP-embedded corpus) not worth it for MVP. Revisit at 200+ shipped signs.
- Risks: headshot color mismatch (color-grade pass), "looks AI" backlash (mitigated by hybrid), text bleed-through (OCR catches), CMYK contrast drift (pre-validate post-conversion).

---

**Footnotes (selected primary sources):**

[^1]: NAR 2025 Profile of Home Buyers and Sellers — https://www.nar.realtor/magazine/real-estate-news/nar-2025-profile-of-home-buyers-sellers-reveals-market-extremes
[^2]: Top 10 Takeaways NAR 2025 — https://www.nar.realtor/blogs/economists-outlook/top-10-takeaways-from-nars-2025-profile-of-home-buyers-and-sellers
[^3]: How Buyers Find Homes (Marc Lyman / NAR) — https://marclyman.com/how-buyers-find-homes/
[^4]: 2024 Profile of Home Buyers and Sellers PDF — https://www.nar.realtor/sites/default/files/2024-11/2024-profile-of-home-buyers-and-sellers-highlights-11-04-2024_2.pdf
[^6]: RE Lead Generation Statistics 2026 — https://realestateagentleads.com/real-estate-lead-generation-statistics/
[^7]: USSC Sign Legibility Rules of Thumb — https://files.secure.website/wscfus/7691102/uploads/USSC_Sign_Legibility_Rules_of_Thumb.pdf
[^8]: USSC Foundation On-Premise Signs 2018 — https://usscfoundation.org/wp-content/uploads/2018/03/USSC-Guideline-Standards-for-On-Premise-Signs-2018.pdf
[^9]: Science of Sign Size — https://houseofsignsco.com/2024/10/17/the-science-of-sign-size-understanding-viewing-distance-and-legibility/
[^10]: Roadside Signage Font Standards — https://www.visix.com/blog/roadside-signage-font-standards/
[^11]: FHWA Highway Guide Sign Fonts Ch. 3 — https://mutcd.fhwa.dot.gov/resources/interim_approval/ia5rptcongress/ch3.htm
[^12]: Custom Sign Center color/fonts — https://customsigncenter.com/blog/index.php/2026/01/23/real-estate-sign-colors-fonts/
[^13]: Indigo Signs color combinations 2025 — https://www.indigosigns.com/news/best-color-combinations-sign-2025-update
[^14]: QR Codes on Real Estate Signs — https://www.the-qrcode-generator.com/blog/qr-codes-on-real-estate-signs (vendor-sourced)

Additional primary sources: gpt-image-2 docs (https://developers.openai.com/api/docs/models/gpt-image-2), Prodigi Print API (https://www.prodigi.com/print-api/docs/reference/), 4over API overview (https://go.4over.com/resources/4over-api-your-connection-to-next-level-growth), KY 201 KAR 11:105 (https://regulations.justia.com/states/kentucky/title-201/chapter-11/105/), HUD EHO graphics (https://www.hud.gov/contactus/hudgraphics).