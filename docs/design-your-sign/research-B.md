I have enough material. Writing the prescriptive guide now.

# Design Best Practices for High-Converting Real Estate Yard Signs

A prescriptive guide for the "Design Your Sign" generator. Each rule is followed by the *why*, a good example, and a common violation to filter out of generated designs.

---

## 1. Typography Rules for Distance Legibility

**1.1 Use bold sans-serif only.** Helvetica, Arial, Futura, Gotham, Proxima Nova, Impact. Serifs blur at distance and on weathered surfaces. ([Custom Sign Center](https://customsigncenter.com/blog/index.php/2026/01/27/typography-at-speed/), [Yard Sign Plus](https://www.yardsignplus.com/blog/real-estate-yard-sign-design))

**1.2 Apply the 1-inch-per-10-feet rule.** Letters must be at least 1 inch tall for every 10 ft of intended viewing distance. For an 18x24 sign read from a car at 30 mph: phone number ~6 in tall (readable at 60 ft), headline readable at 50 ft. ([Signs.com](https://www.signs.com/blog/signage-101-letter-height-visibility/), [Pannier Graphics](https://www.panniergraphics.com/blog/letter-height-visibility-chart-for-outdoor-sign-readability))

**1.3 Stroke weight: medium-bold, never thin.** Stroke thickness should be roughly 12–15% of character height. Thin/elegant weights vanish at distance. ([Erie Custom Signs](https://eriecustomsigns.com/blog/fonts-and-ada-signs.html))

**1.4 Loosen tracking slightly.** Tight kerning makes adjacent letters merge at 30 mph. Add +20 to +40 units of tracking on headline elements. ([Pannier Graphics](https://www.panniergraphics.com/blog/letter-height-visibility-chart-for-outdoor-sign-readability))

**1.5 Hierarchy — non-negotiable order:** (1) Headline "FOR SALE" / "JUST LISTED", (2) Phone number, (3) Agent name, (4) Brokerage, (5) License #, (6) EHO logo. Phone must be the second-largest element. The brokerage logo should *never* be larger than the phone number. ([Yard Sign Plus](https://www.yardsignplus.com/blog/real-estate-yard-sign-design), [Yard Signs.com](https://yardsigns.com/blogs/latest-news-updates/8-professional-yard-sign-design-tips-that-convert))

**Common violation:** Brokerage logo dominates, phone is tiny script. Tanner's pain point exactly.

---

## 2. Color Theory for Outdoor Visibility

**2.1 Use ≤3 colors.** Background, primary text, one accent. ([Yard Sign Plus](https://www.yardsignplus.com/blog/real-estate-yard-sign-design))

**2.2 Ranked high-contrast pairings for outdoor legibility:**

| Rank | Pairing | Notes |
|------|---------|-------|
| 1 | Black on white | Universal baseline; best in sun |
| 2 | Black on yellow | Highest attention-grab; reads best at dusk/night |
| 3 | White on navy | Trust/professional; classic RE |
| 4 | White on red | High impact, slight vibration at distance |
| 5 | White on dark green | Calm; can recede against foliage |

([Indigo Signworks](https://www.indigosignworks.com/news/best-color-combinations-sign-2025-update), [Integrated Signs](https://isasign.com/best-colors-for-sign-contrast-and-visibility/))

**2.3 Require ≥4.5:1 WCAG contrast ratio** between primary text and background. Enforce this programmatically in the generator. ([SF Bay Signs](https://www.sfbaysigns.com/notes/the-role-of-contrast-in-sign-design-for-better-readability))

**2.4 Failure modes by light condition:**
- **Bright sun, glossy finish:** glare destroys readability — require matte print.
- **Overcast:** low-saturation pairings (gray/tan, pastel) lose all hierarchy.
- **Dusk:** red and dark blue both go nearly black — yellow accents save it.

**2.5 Brokerage brand handling.** Keller Williams red, Coldwell Banker blue, RE/MAX red/white/blue, Century 21 gold/black are *required* brand colors with strict guidelines. ([Oakley Sign](https://www.oakleysign.com/keller-williams/), [Oakley Sign – Coldwell Banker](https://www.oakleysign.com/coldwell-banker/)) Honor them in **background and logo only**, then place text in the brand-approved high-contrast pair (e.g., KW red bg → white text, never red text on white). Never invert the franchise palette.

**Common violation:** Brokerage brand color used as text on a busy photo — invisible at 50 ft.

---

## 3. Layout Principles

**3.1 Use landscape orientation (24×18 is industry standard).** Wider format accommodates photo + text in two columns without crowding. ([Oakley Sign](https://www.oakleysign.com/ready-agent-blog/real-estate-yard-sign-ideas/))

**3.2 Z-pattern, not F-pattern.** Yard signs are scanned in 2–3 seconds from a car — a conversion surface, not a comprehension surface. Z-pattern places: headline top-left, photo/logo top-right, name middle, phone + CTA bottom-right (the terminal Z-stop). ([Medium – Z vs F](https://medium.com/@faridafaijati/z-pattern-vs-f-pattern-which-layout-should-you-use-and-when-be1da6d9c035))

**3.3 Whitespace ≥30%.** Crowded signs read as visual noise at distance. Reserve at least one-third of the canvas for negative space around the phone number. ([Yard Signs.com](https://yardsigns.com/blogs/latest-news-updates/8-professional-yard-sign-design-tips-that-convert))

**3.4 Photo placement.** Left third on landscape signs (Western readers' eye lands there first), tightly cropped headshot, neutral background, warm expression. Photo should occupy ~25% of canvas, never more than 33%. ([The Close](https://theclose.com/real-estate-yard-signs/))

**3.5 Border / framing.** A thin solid border (4–6 px equivalent) in the accent color tightens the design and survives weathering. Skip ornate frames — they read as cluttered noise.

---

## 4. Layout Templates That Consistently Convert

**4.1 The Minimalist Agent Sign**
- Top: "FOR SALE" (or blank if blank-canvas)
- Photo left third
- Right two-thirds: Agent Name (large), Phone (largest after headline), brokerage one-liner small
- Two colors max
- Best for: independent agents, modern listings, walkable neighborhoods

**4.2 The Branded Broker Sign**
- Top band: brokerage logo + brand color (~15% canvas)
- Middle: photo + name
- Bottom band: phone + license #
- Three colors: brand + white + black
- Best for: franchise agents (KW/CB/RE/MAX/C21), suburban listings

**4.3 The Luxury / Boutique Sign**
- Pure typography, no photo (or tiny monogram)
- Black or deep-charcoal background, white or metallic-gold text
- Wider tracking, slightly thinner weight than rules 1.3-1.4 — *acceptable trade-off only when the listing relies on QR-code follow-through rather than drive-by phone calls*
- QR code prominent
- Best for: $1M+ listings where discretion signals premium
([JED Signs](https://jedsigns.com/business-signage/luxury-properties-signage/), [Luxury Presence](https://www.luxurypresence.com/blogs/real-estate-sign-ideas/))

**4.4 Proportional rule of thumb (24×18 sign):**
- Headline band: 15% of height
- Photo + name + phone block: 65%
- Compliance footer (brokerage, license, EHO): 20%

---

## 5. Conversion Lift Tactics

**5.1 QR code lower-right.** Links to property page, schedule-a-tour, or agent contact card. Adding QR codes is now the single highest-leverage conversion add to a yard sign. ([Yard Sign Plus](https://www.yardsignplus.com/blog/real-estate-yard-sign-design)) Make it minimum 1.5 in square.

**5.2 Phone format with hyphens, never parentheses.** `859-555-0142` reads faster than `(859) 555-0142` at distance.

**5.3 One CTA, never two.** "Call" *or* "Scan" should dominate. Two equal CTAs split attention and reduce both.

**5.4 No taglines that aren't the agent's name.** "Your Local Expert" wastes the 2-second window.

---

## 6. State-by-State Compliance (KY primary, OH/IN/TN flagged)

> Sign generator should attach a state-rules JSON and refuse to render without it.

**6.1 Kentucky (KREC, 201 KAR 11:105):**
- Broker's **full business name** must appear clearly and conspicuously on every sign — not abbreviated, not stylized to the point of illegibility.
- Written owner consent required before placing a sign (operational, not a design rule).
- Principal broker is liable for affiliate ad violations — meaning broker review is required, not optional.
- Specific license-number-on-sign requirement is **not explicitly mandated** in 201 KAR 11:105, but Kentucky REALTORS® best-practice guidance recommends including it. **Include the license # by default — safer.**
([Justia – 201 KAR 11:105](https://regulations.justia.com/states/kentucky/title-201/chapter-11/105/), [KY Real Estate Class](https://www.kyrealestateclass.com/knowledge-base/kar-11105-advertising-display-of-content-required/))

**6.2 Indiana (876 IAC 8-1-8):** Broker company name as licensed (or publicly known name) must appear. Signs with only phone/PO box/address are prohibited — must identify the brokerage. ([Cornell LII – 876 IAC 8-1-8](https://www.law.cornell.edu/regulations/indiana/876-IAC-8-1-8))

**6.3 Tennessee (TCA 62-13-309 / TREC Rule 1260-02):** Firm name must appear, firm license rules apply; office-sign rule is separate but firm-name-on-advertising is enforced. ([Justia – TCA 62-13-309](https://law.justia.com/codes/tennessee/title-62/chapter-13/part-3/section-62-13-309/))

**6.4 Ohio (Ohio Division of Real Estate):** Brokerage name required on advertising; specific sign-format rules less codified than KY/IN. Default to brokerage-full-name + license to stay safe. ([Ohio DRE](https://elicense3.com.ohio.gov/lookup/licenselookup.aspx))

**6.5 Equal Housing Opportunity logo (federal, HUD):**
- Required on real estate advertising.
- Must be **at least as large as the largest other logo** on the sign.
- Minimum 0.5 in wide in print. Do not alter color/proportion.
- Place bottom-right or bottom-center compliance band.
([HUD](https://www.hud.gov/contactus/hudgraphics), [Fair Sentry](https://fairsentry.com/blog/equal-housing-opportunity-logo))

**6.6 Rule set is state-dependent — flag in the agent intake.** Ask the agent for state of licensure and load a per-state compliance config. Do not let the image model improvise compliance copy; render those elements deterministically as a post-process overlay.

---

## 7. Hard Filters the Generator Must Enforce (Pre-Print)

1. Phone number ≥ 6 in tall on 18×24 layout
2. Sans-serif only (whitelist of fonts)
3. ≥ 4.5:1 contrast on every text element vs its background
4. ≤ 3 colors on canvas
5. Brokerage full legal name present and legible
6. EHO logo present, sized correctly
7. License # present if KY/IN/TN agent
8. No script/decorative fonts
9. No text over the photo
10. QR code present and ≥ 1.5 in

If any filter fails, regenerate or fall back to a template. Do **not** ship the raw model output to print.

---

## Sources
- [Custom Sign Center – Typography at Speed (2026)](https://customsigncenter.com/blog/index.php/2026/01/27/typography-at-speed/)
- [Custom Sign Center – Best Color and Font Choices (2026)](https://customsigncenter.com/blog/index.php/2026/01/23/real-estate-sign-colors-fonts/)
- [Yard Sign Plus – Real Estate Yard Sign Design](https://www.yardsignplus.com/blog/real-estate-yard-sign-design)
- [Yard Signs.com – 8 Tips That Convert](https://yardsigns.com/blogs/latest-news-updates/8-professional-yard-sign-design-tips-that-convert)
- [Signs.com – Letter Height Visibility](https://www.signs.com/blog/signage-101-letter-height-visibility/)
- [Pannier Graphics – Letter Height Chart](https://www.panniergraphics.com/blog/letter-height-visibility-chart-for-outdoor-sign-readability)
- [Indigo Signworks – Best Sign Color Combinations 2025](https://www.indigosignworks.com/news/best-color-combinations-sign-2025-update)
- [SF Bay Signs – Contrast in Sign Design](https://www.sfbaysigns.com/notes/the-role-of-contrast-in-sign-design-for-better-readability)
- [Integrated Signs – Best Colors for Contrast](https://isasign.com/best-colors-for-sign-contrast-and-visibility/)
- [The Close – 13 Best Real Estate Sign Ideas](https://theclose.com/real-estate-yard-signs/)
- [Oakley Sign – 2025 Real Estate Yard Sign Ideas](https://www.oakleysign.com/ready-agent-blog/real-estate-yard-sign-ideas/)
- [Oakley Sign – Keller Williams Signs](https://www.oakleysign.com/keller-williams/)
- [Oakley Sign – Coldwell Banker Signs](https://www.oakleysign.com/coldwell-banker/)
- [JED Signs – Luxury Properties Signage](https://jedsigns.com/business-signage/luxury-properties-signage/)
- [Luxury Presence – Real Estate Sign Ideas](https://www.luxurypresence.com/blogs/real-estate-sign-ideas/)
- [Z-Pattern vs F-Pattern – Medium](https://medium.com/@faridafaijati/z-pattern-vs-f-pattern-which-layout-should-you-use-and-when-be1da6d9c035)
- [Justia – 201 KAR 11:105 Kentucky Advertising](https://regulations.justia.com/states/kentucky/title-201/chapter-11/105/)
- [KY Real Estate Class – KAR 11:105 Display Required](https://www.kyrealestateclass.com/knowledge-base/kar-11105-advertising-display-of-content-required/)
- [Cornell LII – 876 IAC 8-1-8 Indiana Advertising](https://www.law.cornell.edu/regulations/indiana/876-IAC-8-1-8)
- [Justia – TCA 62-13-309 Tennessee Signs](https://law.justia.com/codes/tennessee/title-62/chapter-13/part-3/section-62-13-309/)
- [HUD – Equal Housing Opportunity Graphics](https://www.hud.gov/contactus/hudgraphics)
- [Fair Sentry – EHO Logo Guidelines](https://fairsentry.com/blog/equal-housing-opportunity-logo)
- [Erie Custom Signs – ADA-Compliant Fonts](https://eriecustomsigns.com/blog/fonts-and-ada-signs.html)