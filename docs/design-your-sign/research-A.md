I have enough evidence. Compiling the brief now.

---

# Research Brief: Real-Estate Yard Sign Conversion — What the Evidence Says

**Prepared for:** Ryan (go/no-go on PPI "Design Your Sign" feature)
**Date:** 2026-06-05
**Methodology:** Targeted web searches across NAR primary reports, USSC/FHWA legibility research, and industry sources. Marketing-fluff sources (sign vendors, QR-code SaaS) flagged inline.

---

## 1. How much do yard signs actually drive lead flow?

**The honest answer: thinner data than vendor marketing claims, and trending down for ~30 years.**

- **NAR Profile of Home Buyers and Sellers (2025 edition, July 2024–June 2025 survey window)** is the authoritative source. Headline: **88% of buyers used an agent, 91% of sellers used an agent, 66% of sellers found their agent via referral or repeat relationship** [1][2]. Agents are found through people, not signs.
- One frequently-cited industry summary attributes **~8% of home discovery** (buyer-side, "how did you find the home you purchased") to **yard signs / open house signs combined** [3]. Caveat: this is finding the *home*, not finding the *agent* — the conversion mechanism the PPI feature targets is more like "drive-by → call agent" which is a much narrower funnel.
- **51% of buyers found their home online; 100% of recent buyers used the internet during search** (vs. 2% in 1995) [4]. Yard sign discovery has been displaced by Zillow/Redfin since roughly 2010.
- **Average calls per yard sign per month: no peer-reviewed or NAR figure exists.** Vendor blogs cite anecdotes ("340 scans / 47 leads") without methodology [5]. Treat as marketing. The closest credible benchmark is the industry-wide lead conversion rate of **1.8–4.6% across all RE lead sources, ~2.4% average** [6].

**Implication for Ryan:** Yard signs are a secondary, declining channel for buyer/seller discovery. The strongest argument for the PPI feature is **brand/recall for the agent's farm area**, not primary lead-gen ROI. Be careful about pitching this as a high-volume call generator — the data doesn't support that claim.

---

## 2. The readability / "30mph" question

This is where the evidence is rigorous and Tanner's instinct is correct.

### The 1-inch-per-10-feet rule is real and sourced

- **United States Sign Council (USSC) Legibility Index = 30** as a general-purpose value: 1 inch of capital letter height is readable at ~10 feet under good conditions, ~30 feet maximum [7][8]. Underlying research conducted by **Pennsylvania Transportation Institute, Penn State** [9].
- **Important distinction:** "Readable" (parse the text, 20/20 vision, ideal conditions) ≠ "Visible" (notice the sign exists). Visibility extends 3–10x further than readability [9].

### What this means for a yard sign at 30mph

- Typical RE yard sign is **~30 feet from a passing driver** (curb-to-lane offset + vehicle position).
- 1"/10ft rule → **letters must be at least 3" tall** to be merely readable. To be readable comfortably while driving, USSC and FHWA work suggests doubling to give reaction time: **~6" for the critical info** (phone number, agent name).
- **At 30 mph, 8" letters are visible for only 1.8 seconds**; at 60 mph that drops to 0.9 seconds [10]. FHWA research recommends **2–7 information items per sign max** so the brain can process the message in **under 2.5 seconds** [10][11].
- **FHWA driver reaction time data:** mean reaction time was **1.3s for 4-panel signs, 1.6s for 6-panel, 2.2s for 9-panel** (drivers under 50) [11]. More elements = slower processing, non-linearly.

**Implication for the image-model design system:** the generator must enforce hard constraints:
- ≤ 5 distinct information elements per sign
- Phone number ≥ 6" character height at typical 18x24" sign dimensions
- High-contrast color combos (see §4)
- No decorative serif/script fonts for primary info

These are quantifiable, testable constraints — exactly the kind of thing a layout-aware prompt or post-generation linter could verify.

---

## 3. Color contrast — strong consensus

- **Highest-readability combos** (across multiple industry and USSC-derived sources): black-on-yellow (matches DOT traffic-sign rationale), black-on-white, white-on-dark-blue [12][13].
- Recommended **contrast ratio ≥ 70%** between text and background [13].
- **Failure modes documented:** thin fonts, low-contrast pairs (light-blue on white, gold on cream — common in luxury RE branding), and complex layouts force longer cognitive processing and reduce comprehension [13].
- **Grayscale test:** sign should be legible in grayscale to handle color-blind viewers (~8% of men) [13].

Note: sources here are sign-industry blogs synthesizing USSC and ADA guidance, not peer-reviewed. The 70%-contrast figure is widely repeated but I could not find the originating study. Directionally reliable.

---

## 4. QR codes — promising on paper, weakly evidenced in real estate

- Industry sources cite a **2024 case study where a "Home Value Estimate" QR code converted 13.6% of scans into listing leads** [14], and Bitly-sourced data showing **~37% click-through rate** on QR journeys vs. 2–5% for display ads [14].
- **NAR 2025 Technology Survey** reportedly found **67% of buyers under 45 expect smartphone access to property details before talking to an agent** [14] — this is the strongest pro-QR data point.
- **Heavy caveat:** the 13.6% number comes from a single agent's testimonial via a QR-code vendor blog. Treat as plausible but not proven. **The "QR sitting alone gets ~0 scans, QR with a value prop converts" insight is consistent and likely true** — the sign needs to tell drivers *why* to scan ("Scan for instant home value" beats "Scan me").

**Implication:** the image generator should include a QR-code zone with a value-prop microcopy field, not just a bare QR.

---

## 5. Common failure modes in current RE signage (matches Tanner's hypothesis)

Across sources [12][15][16], the recurring complaints:

1. **Brokerage logo dominates over agent contact info.** Compliance requirements force brokerage branding but most signs over-weight it. Agent phone number is often 1/3 the size of the brokerage logo.
2. **Decorative script fonts on agent name / brokerage name** unreadable past 15 ft.
3. **Low-contrast luxury palettes** (gold/cream, navy/gray) — chosen for aesthetics, terrible for distance.
4. **Information density >7 items** (agent name, photo, phone, email, website, brokerage logo, brokerage tagline, license number, "For Sale," QR code, riders) — exceeds the 2.5s processing window [10][11].
5. **Phone number not "chunked"** with dashes — harder to memorize at a glance [15].

---

## 6. Design elements correlated with response (evidence quality varies)

| Element | Evidence | Notes |
|---|---|---|
| **Phone number prominence + chunking** | Strong (USSC processing research, multiple agent-coaching sources) | Should be the second-largest element after "FOR SALE" headline |
| **Vanity phone numbers** (e.g., 800-BUY-HOME) | Moderate (vendor data, no controlled study) | Plausibly help recall; not essential for MVP |
| **Headshot on sign** | **Mixed / contested** [15] | Some sources advocate; others say save it for the website. No conversion study found. Defensible either way. |
| **QR code with value prop** | Moderate (vendor-sourced) | Likely a net positive if value prop is clear |
| **High-contrast color** | Strong (USSC, FHWA principles) | Non-negotiable |
| **≤5 info elements** | Strong (FHWA driver reaction research) [11] | Hard constraint for generator |

---

## 7. Honest assessment of evidence quality

- **Tier 1 (high confidence):** USSC legibility index, FHWA driver-reaction research, NAR aggregate buyer/seller behavior. Cite these in any pitch deck.
- **Tier 2 (directional):** color contrast recommendations, processing-time guidelines. Synthesized from primary research but repeated through industry intermediaries.
- **Tier 3 (anecdotal / vendor-sourced):** QR scan rates, "calls per sign," individual agent case studies. Useful as illustration, dangerous as the basis for ROI claims.
- **Notable absence:** I found **no controlled A/B study of RE yard sign designs** with measured call-volume outcomes. The industry runs on intuition and vendor marketing. **This is actually an opportunity** — PPI could be the first to run real A/B tests across its agent base because the inventory + customer mapping infra already exists.

---

## 8. What this tells you about the "RAG for image-model layout" problem

Tanner's framing of the hard problem is mostly right but slightly off. The real engineering problem is **not** teaching an image model conversion psychology — it's **enforcing measurable constraints** the research already establishes:

- Letter height ≥ X" for distance Y → measurable post-generation (OCR + bbox heights)
- ≤5 info elements → measurable (count text regions)
- Contrast ratio ≥ 70% → measurable (sample pixels in text bbox vs. background)
- High-contrast palette from approved list → constrain in prompt

This reframes the problem from "RAG for design intuition" to "constrained generation + automated linter." Much more tractable. The image model's job is aesthetics + composition within hard rails — not learning RE marketing theory.

---

## Sources

1. [NAR 2025 Profile of Home Buyers, Sellers Reveals Market Extremes](https://www.nar.realtor/magazine/real-estate-news/nar-2025-profile-of-home-buyers-sellers-reveals-market-extremes)
2. [Top 10 Takeaways from NAR's 2025 Profile of Home Buyers and Sellers](https://www.nar.realtor/blogs/economists-outlook/top-10-takeaways-from-nars-2025-profile-of-home-buyers-and-sellers)
3. [How Buyers Find Homes — Marc Lyman (citing NAR)](https://marclyman.com/how-buyers-find-homes/)
4. [2024 Profile of Home Buyers and Sellers — NAR PDF](https://www.nar.realtor/sites/default/files/2024-11/2024-profile-of-home-buyers-and-sellers-highlights-11-04-2024_2.pdf)
5. [QR Codes for Real Estate: Yard Signs & Listings — QRLynx](https://qrlynx.com/blog/qr-codes-for-real-estate) (vendor source, treat as anecdotal)
6. [75+ Real Estate Lead Generation Statistics 2026](https://realestateagentleads.com/real-estate-lead-generation-statistics/)
7. [USSC Sign Legibility Rules of Thumb (PDF)](https://files.secure.website/wscfus/7691102/uploads/USSC_Sign_Legibility_Rules_of_Thumb.pdf)
8. [USSC Foundation — On-Premise Signs Guideline Standards 2018 (PDF)](https://usscfoundation.org/wp-content/uploads/2018/03/USSC-Guideline-Standards-for-On-Premise-Signs-2018.pdf)
9. [The Science of Sign Size: Viewing Distance and Legibility](https://houseofsignsco.com/2024/10/17/the-science-of-sign-size-understanding-viewing-distance-and-legibility/)
10. [Roadside Signage Font Standards — Visix](https://www.visix.com/blog/roadside-signage-font-standards/)
11. [FHWA Report on Highway Guide Sign Fonts (Chapter 3, Clearview research)](https://mutcd.fhwa.dot.gov/resources/interim_approval/ia5rptcongress/ch3.htm)
12. [Best Color and Font Choices for Readable Real Estate Signs — Custom Sign Center](https://customsigncenter.com/blog/index.php/2026/01/23/real-estate-sign-colors-fonts/)
13. [Best Sign Color Combinations for Readability & Branding 2025 — Indigo Signs](https://www.indigosigns.com/news/best-color-combinations-sign-2025-update)
14. [How Real Estate Signs With QR Codes Bring in Qualified Leads — QR Code Generator](https://www.the-qrcode-generator.com/blog/qr-codes-on-real-estate-signs) (vendor source)
15. [How to Design a Real Estate Yard Sign That Actually Gets Calls — Yard Sign Plus](https://www.yardsignplus.com/blog/real-estate-yard-sign-design)
16. [The 13 Best Real Estate Sign Ideas — The Close](https://theclose.com/real-estate-yard-signs/)