I have enough to write the assessment. Producing the final deliverable now.

---

# Image Model Feasibility Assessment — "Design Your Sign"
**Researcher C • 2026-06-05 • For Ryan**

## TL;DR

**Recommendation: Hybrid architecture (AI background + programmatic text overlay), not full-AI end-to-end.**

Even with gpt-image-2's claimed 99% text accuracy, a 1% spelling failure rate on phone numbers and license numbers is unshippable for print. A hybrid pipeline gets you image-model creativity for layout/style while guaranteeing typography correctness via SVG. Cost-per-sign for AI generation lands at **~$0.20–$0.85**, dwarfed by print + ship (~$15–$40). The image model is not the cost bottleneck — it's the correctness bottleneck.

---

## 1. Current State of OpenAI Image Models (June 2026)

**gpt-image-2 is live.** OpenAI released it April 21, 2026; API opened early May 2026. ([OpenAI docs](https://developers.openai.com/api/docs/models/gpt-image-2), [WaveSpeed pricing](https://wavespeed.ai/blog/posts/gpt-image-2-pricing-2026/))

- **Pricing (token-based):** $5/M text-input, $8/M image-input, $30/M image-output tokens. Per-image cost at 1024×1024: low ≈ $0.006, medium ≈ $0.053, **high ≈ $0.211**. ([CostGoat](https://costgoat.com/pricing/openai-images), [WaveSpeed](https://wavespeed.ai/blog/posts/gpt-image-2-pricing-2026/))
- **Resolution:** Max edge ≤ 3840px, pixel count up to 8.29M (e.g., 3840×2160). ([Apiyi resolution guide](https://help.apiyi.com/en/gpt-image-2-vip-size-resolution-complete-guide-en.html))
- **Reference images:** Up to 16 reference images for `images.edit`; identity preservation is "always on" with no tuning knob. ([fal.ai](https://fal.ai/learn/tools/prompting-gpt-image-2), [OpenAI community](https://community.openai.com/t/collection-of-gpt-image-generator-2-0-issues-bugs-and-work-around-tips-check-first-post/1379535))
- **Masking/inpainting:** `images.edit` accepts an optional mask — white = regenerate, black = preserve pixel-perfect. ([WaveSpeed API guide](https://wavespeed.ai/blog/posts/gpt-image-2-api-guide/))

**Competitive landscape:**

| Model | Per image | Text accuracy | Native max | Notes |
|---|---|---|---|---|
| gpt-image-2 (high) | $0.21 | ~99% claimed | 3840×2160 | Best identity preservation, masking |
| Ideogram 4.0 | $0.03–$0.10 | ~90–95% | 2K native | Open-weight, character reference, **typography specialist** ([Ideogram pricing](https://ideogram.ai/features/api-pricing), [the-decoder](https://the-decoder.com/ideogram-4-0-drops-as-an-open-weight-model-with-native-2k-resolution-and-improved-text-rendering/)) |
| Recraft V3 | $0.04 raster / **$0.08 vector** | Strong | Vector = scalable | **Only model with native SVG output** ([Recraft docs](https://www.recraft.ai/docs/api-reference/pricing)) |
| Imagen 4 Ultra | $0.06 | Strong, "best in class" for typography per some reviews | High | Tied with gpt-image-2 for text quality ([Google Devs blog](https://developers.googleblog.com/imagen-4-now-available-in-the-gemini-api-and-google-ai-studio/)) |
| Imagen 4 Fast | $0.02 | Good | High | Cheapest credible option |

Anthropic still does not ship a first-party image generation API as of June 2026.

---

## 2. The Typography Problem (the deal-breaker)

This is the question that decides go/no-go.

**Marketing claims vs. reality:**
- gpt-image-2 markets **"99% text accuracy"** for Latin script ([Picsart benchmark](https://picsart.com/ai-models/gpt-2/), [Tosea guide](https://tosea.ai/blog/gpt-image-2-complete-guide))
- Ideogram independent benchmarks: ~90% on short phrases, **fails on multi-line and small fonts** ([pxz.ai review](https://pxz.ai/blog/ideogram-ai-review-2026))

**Why 99% is not good enough for this product:**

A yard sign has roughly these strings the agent expects to be correct:
1. Agent first + last name
2. Phone number (10 digits, zero tolerance for error)
3. Brokerage name
4. License number
5. Optional: website / QR-coded URL

At 99% per-character or per-string accuracy on, say, 6 distinct text elements, you get a sign-level success rate of ~94%. **One in 17 generated signs ships with a typo.** A wrong digit in a phone number means the agent's leads go to a stranger. That is a refund + brand damage event, not a re-print event.

The OpenAI Developer Community forum thread on gpt-image-2 issues still cites text rendering bugs as a recurring complaint even post-launch ([forum thread](https://community.openai.com/t/collection-of-gpt-image-generator-2-0-issues-bugs-and-work-around-tips-check-first-post/1379535)).

**Conclusion:** the image model cannot be trusted to render the exact text strings. Period.

---

## 3. Headshot Integration

This part actually works well.

- gpt-image-2 preserves "faces, logos, product details" across edits and handles up to 16 reference images. ([fal.ai prompting guide](https://fal.ai/learn/tools/prompting-gpt-image-2))
- Masking lets you lock a region — useful for "headshot goes in this rectangle, leave it untouched."
- Ideogram 4.0's Character Reference matches identity from a **single** photo without LoRA training. ([Ideogram Character](https://ideogram.ai/features/character/))

**Practical pattern:** generate the sign layout with the AI, then composite the actual uploaded headshot (cleaned, background-removed) into a known coordinate via Sharp/Canvas. Don't trust the model to "place" the real photo — trust it to design a hole-shaped layout, then drop the real photo in programmatically.

---

## 4. Resolution & Print Cost

A 24"×18" yard sign at 300 DPI = **7200×5400 px (38.9 MP)**.

gpt-image-2 maxes at ~3840×2160 (8.3 MP) — **roughly 4.7× short on pixel count for print spec.**

**Mitigations:**
- 150 DPI is acceptable for yard signs (viewed from 5+ feet at vehicle speed, per [Denver Printing yard-sign legibility guide](https://www.denverprintingcompany.com/yard-signs/enhancing-yard-sign-legibility-design-principles/)). That drops the requirement to 3600×2700 = 9.7 MP, still slightly above gpt-image-2's native ceiling.
- Run output through a 2× upscaler (Topaz, Magnific, or [LetsEnhance for print](https://letsenhance.io/blog/guide/upscale-ai-generated-image-for-print/)). Adds ~$0.05–$0.20 per image.
- **Or — and this is the whole argument for the hybrid approach — rasterize SVG to whatever resolution the print vendor needs at zero quality loss.**

---

## 5. Print-Ready Honest Assessment

Current image models are **"good enough for digital preview, not yet for press"** when the design is text-heavy and the text is identity-critical (names, numbers).

Specifically:
- Pure photographic/illustrative content: print-ready today.
- Stylized typography with exact strings: still risky.
- Yard signs (which are 80% typography): do not ship end-to-end AI.

This matches what [Custom Sign Center's Jan 2026 typography research](https://customsigncenter.com/blog/index.php/2026/01/27/typography-at-speed/) finds: at 30mph, legibility requires 7–8" letter heights with sans-serif bold weights and high-contrast colors. AI models can approximate the look, but a 0.5px shift in baseline alignment or a swapped digit is invisible to the model and fatal to the product.

---

## 6. Architecture Options Compared

### Option A — Full AI end-to-end (NOT RECOMMENDED)
- gpt-image-2 generates entire sign from prompt + headshot + agent details.
- **Cost:** ~$0.21 per attempt × ~3 regenerations avg = ~$0.63/sign.
- **Risk:** 5–10% of approved signs ship with typos. QA burden is enormous. No-go.

### Option B — Hybrid: AI background + programmatic text (RECOMMENDED)
- AI generates background design, color palette, decorative elements, layout zones (with placeholder text the model will likely get wrong — we don't care).
- Backend uses SVG/Sharp/`@napi-rs/canvas` to composite the **real** agent name, phone, license, headshot into known coordinate boxes.
- Print vendor receives a vector PDF or rasterized PNG at any DPI.
- **Cost:** ~$0.21 image + ~$0.05 upscale + negligible compute = **~$0.30/sign generated, ~$0.10/sign after caching backgrounds across agents.**
- **Risk:** essentially zero typo risk. Exact corporate fonts. Brokerage compliance is enforceable.
- **Implementation complexity:** ~2 weeks. Need a small DSL for "AI design zone vs. text zone."

### Option C — Template-based + AI background
- Designer creates 6–10 hand-tuned SVG templates (per-brokerage variants).
- AI only generates a background hero image / decorative motif behind the template.
- Variable-data fills name/phone/license/headshot.
- **Cost:** ~$0.06/sign (Imagen 4 Fast for backgrounds only).
- **Risk:** lowest. Signs always look on-brand. Less differentiation per agent.
- **Implementation complexity:** ~1 week + ongoing template design work.

**My recommendation: launch with Option C, evolve toward Option B once you have data on what agents actually want.** Option C gets you to market in a sprint; Option B is the differentiated long-term product.

---

## 7. Recommended MVP Stack

- **Image model:** Ideogram 4.0 ($0.06/img) for background generation (cheapest credible + good aesthetic). Fall back to gpt-image-2 for the "regenerate, premium quality" button at $0.21/img.
- **Headshot processing:** [remove.bg](https://www.remove.bg) API or Sharp + a segmentation model for background removal (~$0.10/headshot, cache forever).
- **Composition:** `@napi-rs/canvas` or `resvg` server-side in your existing Next.js API route. Renders SVG → PDF at any DPI.
- **Storage:** S3/R2 for final print-ready PDFs.
- **Print API:** out of my scope (Researcher A's brief), but the artifact you hand them is a vector PDF — accepted by every major print-on-demand house.
- **Prisma schema:** new `CustomerSign` rows with `sourceType='custom_designed'`, foreign key to a `SignDesign` record storing the prompt, model name, seed, generated background URL, and SVG template ID for reproducibility.

**All-in cost per finalized sign:** ~$0.30 in AI/compute + print/ship (your existing third-party economics). Image generation is **<2% of COGS** — optimize for quality, not API cost.

---

## Sources

- [GPT Image 2 — OpenAI docs](https://developers.openai.com/api/docs/models/gpt-image-2)
- [GPT Image 2 Pricing — WaveSpeed](https://wavespeed.ai/blog/posts/gpt-image-2-pricing-2026/)
- [GPT Image 2 API Guide — WaveSpeed](https://wavespeed.ai/blog/posts/gpt-image-2-api-guide/)
- [OpenAI Image Pricing Calculator — CostGoat (Jun 2026)](https://costgoat.com/pricing/openai-images)
- [GPT Image 2 Resolution Guide — Apiyi](https://help.apiyi.com/en/gpt-image-2-vip-size-resolution-complete-guide-en.html)
- [GPT Image 2 99% Text Accuracy — Picsart](https://picsart.com/ai-models/gpt-2/)
- [GPT Image 2 Issues Thread — OpenAI Community](https://community.openai.com/t/collection-of-gpt-image-generator-2-0-issues-bugs-and-work-around-tips-check-first-post/1379535)
- [GPT Image 2 Prompting Guide — fal.ai](https://fal.ai/learn/tools/prompting-gpt-image-2)
- [Ideogram API Pricing](https://ideogram.ai/features/api-pricing)
- [Ideogram 4.0 Launch — the-decoder](https://the-decoder.com/ideogram-4-0-drops-as-an-open-weight-model-with-native-2k-resolution-and-improved-text-rendering/)
- [Ideogram Character Reference](https://ideogram.ai/features/character/)
- [Ideogram AI Review 2026 — pxz.ai](https://pxz.ai/blog/ideogram-ai-review-2026)
- [Recraft API Pricing](https://www.recraft.ai/docs/api-reference/pricing)
- [Imagen 4 in Gemini API — Google Developers Blog](https://developers.googleblog.com/imagen-4-now-available-in-the-gemini-api-and-google-ai-studio/)
- [AI Image API Pricing Comparison 2026 — buildmvpfast](https://www.buildmvpfast.com/api-costs/ai-image)
- [Yard Sign Legibility — Denver Printing](https://www.denverprintingcompany.com/yard-signs/enhancing-yard-sign-legibility-design-principles/)
- [Typography at Speed Research — Custom Sign Center (Jan 2026)](https://customsigncenter.com/blog/index.php/2026/01/27/typography-at-speed/)
- [Upscaling AI Images for Print — LetsEnhance](https://letsenhance.io/blog/guide/upscale-ai-generated-image-for-print/)