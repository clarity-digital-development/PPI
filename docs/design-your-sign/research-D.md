Acknowledged on TodoWrite reminder — single-shot research task, not needed. I have sufficient data. Here is the final report.

---

# Researcher D: Print-on-Demand Partners for RE Yard Signs

**For:** Ryan / go-no-go on "Design Your Sign" feature
**Date:** 2026-06-05
**Bottom line:** Two viable paths exist today. **Recommended primary: 4over** (API + Coroplast + reseller dropship). **Recommended fallback / fast-start: Prodigi (Pwinty) API** — modern REST, fewer hoops, but metal-only for yard signs. **In-house printing is not worth it for v1.**

---

## Vendor Comparison Table

| Vendor | Public API? | File Formats | Min Qty | Approx Cost @ qty 1 | Turnaround | Ship-to-Customer | White-label / Blind Ship | RE Templates | Materials | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **4over** | Yes — REST, HMAC-SHA256 auth; reseller account required (resale cert + approval). | PDF (preferred), PNG | 1 | ~$5–$10 single 18x24 Coroplast (reseller pricing tiered, not publicly listed; ballpark from industry guides) | 1–3 business days production | Yes (dropship) | Yes (blind ship is standard for resellers) | No first-party RE templates; you build them | 4mm/10mm Coroplast, 3mm PVC, aluminum, banners | **STRONGEST FIT** for integrated workflow |
| **Prodigi (Pwinty)** | Yes — REST v4, well-documented, modern dev experience | PDF, PNG, JPG | 1 | Listed publicly per product (mid-tier) | 2–5 business days | Yes (global dropship is core product) | Yes | No | Metal yard signs only (18x24 aluminum w/ frame, 6x24 rider) — no Coroplast | **Fast MVP fallback**; metal-only is a constraint |
| **SinaLite** | Yes — public API signup page, REST | PDF | 1 | Reseller-tier (not public) | 1–3 days | Yes — explicitly "blind ship" | Yes (blind ship default) | No | 3 Coroplast thicknesses, banners, posters | **Strong alternative to 4over**; smaller catalog |
| **Dee Sign** | **No public API** (sales call only) | Web upload only | 1 | Factory-direct retail | 10–15 business days (slow) | Yes | Limited | **Yes — RE-specialized**, franchise-approved templates (REMAX, KW, etc.) | Coroplast, aluminum, reflective | RE-native but **slow + no API** — disqualifies for v1 |
| **Lowen Sign** | **No public API** | Web upload | 1 | Factory-direct | 3-day production | Yes | No | **Yes — RE-specialized**, 30+ franchise approvals | Coroplast, aluminum, panels, posts | Same problem as Dee — no API |
| **Oakley Sign** | **No public API** | Web upload | 1 | Retail | ~3 business days | Yes | No | **Yes — RE-native**, "largest RE sign mfg" | Coroplast, aluminum, reflective | No API |
| **Signazon** | **No public API found** | Web designer + upload | 1 | Retail | Standard | Yes | Unknown | Yes — RE template gallery | Coroplast, ACM, aluminum | No API |
| **Signs.com** | **No public API found** | Web upload | 1 | Retail | Standard | Yes | Unknown | Templates exist | 4mm Coroplast standard | No API |
| **BuildASign** | **No public API** (internal only per GitHub presence) | Web upload | 1 | Retail | Next-day on some products | Yes | No | RE template gallery | Coroplast, aluminum | No API |
| **Vistaprint Pro / Corporate** | **No public-developer API**; "ProShop" is a hosted storefront, not a programmatic integration. Listed in apitracker.io but no docs. | Web upload | 1 | Retail / negotiated for corporate | 3–7 days | Yes | Possible via Corporate contract | Generic | Coroplast, aluminum | Sales-call only; **not API-first** |
| **Smartpress** | **No public API found** | PDF | 1 | Mid-tier retail | 2–4 days | Yes | Unknown | No | Coroplast | No API |
| **GotPrint** | **No public API found** | PDF, PNG | 1 | Low retail | 2–4 days | Yes | Unknown | RE templates exist | Coroplast | No API |
| **Sign Outfitters** | **No public API** | Web upload | 25+ for many products | Retail | Standard | Yes | No | Generic | Coroplast | No API |

---

## Recommendation #1: **4over** (primary)

**Why:** Only vendor that combines (a) public REST API with documented HMAC auth, (b) the right materials (4mm/10mm Coroplast, the RE industry standard), (c) reseller-tier wholesale pricing, (d) blind/dropship as a first-class feature, and (e) US factory footprint with 1–3 day production.

**How it fits PPI's flow:**
- Agent designs → PPI calls 4over API with PDF + ship-to = PPI installer warehouse
- 4over prints, blind-ships in 1–3 days → installer receives → installs → cost is added to customer's PPI order with markup (you control pricing)
- Tracking number is returned via the API → flows to PPI dashboard

**Gotchas Ryan should know:**
- Reseller account requires a **valid state resale certificate** (annual re-verification) and a multi-step approval. Plan ~1–2 weeks lead time. ([4over reseller cert FAQ](https://go.4over.com/4over-reseller-certificate-faq))
- API is REST but uses **HMAC-SHA256 signature auth** with API key + private key. Not OAuth. Inventory items need UUIDs pre-registered. There's a learning curve; PHP SDK exists on GitHub but no first-party JS/TS SDK. ([4over API overview](https://go.4over.com/resources/4over-api-your-connection-to-next-level-growth))
- Per-unit pricing **not publicly listed** — requires sales call to confirm exact tier. Industry signal: $5–10/unit for single 18x24 Coroplast at reseller rates, dropping to ~$2.50 at qty 100+.
- No RE-specific compliance fields (EHO logo, license #) — that's PPI's job in the design step before submission.

---

## Recommendation #2: **Prodigi / Pwinty** (fast-start fallback)

**Why:** Best documented REST API of any vendor surveyed — v4, OpenAPI-style docs, mobile SDKs, designed for indie devs (Pwinty was acquired by Prodigi in 2017 specifically because of its API quality). ([Prodigi API docs](https://www.prodigi.com/print-api/docs/reference/))

**Strong points:**
- No reseller-cert approval gate — sign up and ship
- Global fulfillment network (US, UK, EU, AU, CA)
- Pricing is public per product
- Dropshipping is the core product, not a feature

**Hard constraint:** Yard sign offering is **metal/aluminum composite only** (18x24 panel + optional 6x24 rider). No Coroplast. ([Prodigi metal yard signs](https://www.prodigi.com/products/business-and-commercial/banners-and-signs/yard-signs/metal-yard-signs/))

For PPI this is actually defensible — metal RE signs are **premium product** (longer-lasting, higher perceived quality) and could be positioned as the upsell tier vs. cheap Coroplast competitors. But the unit cost will be ~3–5× higher than Coroplast.

**Recommended use:** Prototype the entire end-to-end flow on Prodigi in week 1 (sign up takes minutes), validate the agent UX, then migrate to 4over once the reseller approval clears.

---

## Recommendation #3: Skip — RE-native vendors (Dee, Lowen, Oakley)

All three are the dominant RE-sign printers (Dee = "largest in nation", Lowen = REMAX/KW approved, Oakley = "largest custom RE manufacturer"). They have **exactly the right product and templates** — including franchise-brand compliance, license number fields, photo riders.

**But none of them have a public API.** Dee's "Guaranteed Shipment Program" is 10–15 business days, which would gut the agent UX (real estate listing timelines are days, not weeks).

**Action for Ryan:** Worth a sales call to Lowen specifically (3-day production, 30+ franchise approvals). If they'll do EDI or a private REST endpoint for a volume commitment, they become the long-term ideal partner. Right now, no go.

---

## In-House Print Shop — quantified for comparison

Equipment needed for direct-to-Coroplast printing:

| Item | Indicative cost |
|---|---|
| Roland VersaOBJECT MO-240 (entry, 18x24 flatbed) | ~$25k |
| Roland EU-1000MF (high-volume flatbed) | $150k–$250k |
| HP Latex R2000 flatbed | $200k+ |
| Mimaki JFX200 (entry-tier flatbed) | ~$80k |
| CNC cutter / shear for Coroplast trim | $15k–$40k |
| UV ink, Coroplast inventory, install/training | $20k+ |
| Operator (1 FTE) | $60k/yr |

**Verdict:** Out of scope for v1. Even the entry path is **~$120k capex + 1 FTE** before producing a single sign. 4over does this for ~$5/sign with zero capex. Revisit in-house only if PPI hits ~5,000 signs/month — which is years away. ([Roland yard sign printers](https://www.rolanddga.com/applications/print-on-yard-signs))

---

## Suggested implementation path for PPI

1. **Week 1 (parallel):** (a) Submit 4over reseller application + resale cert. (b) Sign up for Prodigi, build the API integration against Prodigi sandbox as the working prototype.
2. **Week 2–3:** Build `CustomerSign` with `sourceType='custom_designed'`, new `PrintOrder` table holding vendor + external order ID + tracking number. Stub vendor adapter pattern (`PrintVendor` interface with `4over` and `prodigi` implementations) so swapping is trivial.
3. **Week 4:** Once 4over approval lands, swap default vendor to 4over for Coroplast; keep Prodigi for the metal upsell tier.
4. **Ongoing:** Sales call with Lowen for v2 — if they'll commit to API access at volume, they're the endgame partner because of RE compliance built-in.

---

**Open questions only a sales call resolves:**
- 4over exact per-unit cost at PPI's projected volume (50–500 signs/month)
- 4over ability to print **double-sided** custom Coroplast in the API (catalog shows it; need to confirm SKU-level)
- Whether Lowen will do any form of programmatic ordering for a committed volume

**Sources:**
- [4over wholesale printing](https://4over.com/wholesale-printing)
- [4over API overview](https://go.4over.com/resources/4over-api-your-connection-to-next-level-growth)
- [4over reseller account](https://4over.com/company/account/create)
- [4over reseller certificate FAQ](https://go.4over.com/4over-reseller-certificate-faq)
- [4over 4mm Coroplast](https://4over.com/4coro-coroplast-signs)
- [Prodigi Print API](https://www.prodigi.com/print-api/)
- [Prodigi API docs](https://www.prodigi.com/print-api/docs/reference/)
- [Prodigi metal yard signs](https://www.prodigi.com/products/business-and-commercial/banners-and-signs/yard-signs/metal-yard-signs/)
- [SinaLite API signup](https://sinalite.com/en_us/api-signup)
- [SinaLite Coroplast](https://sinalite.com/en_us/large-format/coroplast-signs.html)
- [Dee Sign](https://www.deesign.com/)
- [Lowen Sign Company](https://www.lowensign.com/)
- [Oakley Signs](https://www.oakleysign.com/)
- [Signazon real estate yard signs](https://www.signazon.com/real-estate-yard-signs/)
- [Signs.com yard signs](https://www.signs.com/yard-signs/)
- [BuildASign real estate yard signs](https://admin.buildasign.com/yard-signs/browse-real-estate)
- [Vistaprint ProShop](https://vistaprintcorporate.com/proshop/)
- [Smartpress real estate yard signs](https://smartpress.com/offering/real-estate-yard-signs)
- [GotPrint yard signs](https://www.gotprint.com/products/yard-signs/info.html)
- [Roland yard sign printers](https://www.rolanddga.com/applications/print-on-yard-signs)