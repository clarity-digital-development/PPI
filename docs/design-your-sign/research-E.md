I have sufficient evidence. Writing the final research deliverable now.

---

# Researcher E — The Hard Engineering Question: Conversion-Optimized Sign Generation

**For:** Ryan (go/no-go on PPI "Design Your Sign")
**Question:** How do we apply RAG / prompting to an image model so it consistently produces conversion-optimized real-estate yard signs?
**TL;DR:** Don't ask an image model to design the sign. Have an **LLM-planner produce a JSON design spec → image model generates only the background/headshot stylization → typography is composited programmatically in SVG/Canvas → OCR-validated → human-approved → print**. This is the only architecture that hits PPI's accuracy bar for printed signage. Confidence: high.

---

## 1. Why naive prompting fails

Image models in 2026 (GPT Image 2, Imagen 4, Ideogram 4) finally render text well in the abstract — Ideogram 4 hits ~0.97 on X-Omni English OCR, GPT Image 2 ~0.95. That sounds great until you remember **PPI signs go to a print vendor**. At 24"×18" printed at 150–300 DPI, a single mis-rendered character on the agent's phone number is a destroyed sign and a refund. A 95% text accuracy rate is a **5% defect rate** on the most load-bearing element of the sign. That's unshippable.

Beyond text, naive prompts fail three other ways:
- **Layout instability:** "Make a yard sign for John Smith, XYZ Realty" yields randomized hierarchy on every regen — agent name might be 8pt one time, 60pt the next. Yard sign best practice requires the phone number be the largest readable element with 1-inch-per-10-feet legibility ratio; image models don't enforce this.
- **Non-determinism:** seed-locked GPT Image 2 still drifts ~10–15% across regenerations. An agent's brand identity needs to be reproducible across re-orders.
- **Headshot fidelity:** the agent's actual face must appear unchanged. Pure text-to-image regenerates a stylized face — wrong person.

## 2. Techniques evaluated

| Technique | Verdict for PPI | Why |
|---|---|---|
| (a) Structured prompt templates | Necessary but insufficient | Reduces variance; still ~5% text-render errors. Use as input to (f). |
| (b) Few-shot reference images in prompt | Mid value | GPT Image 1/2 supports multi-image input. Helps style/mood transfer, doesn't fix layout determinism. |
| (c) Img2img with layout template | High value | Maps directly to inpainting workflow (see below) — but gpt-image-1's mask compliance is "guidance only, not exact" per OpenAI's own forum. Risky for printed output. |
| (d) Reference image conditioning | Use for style only | Good for matching brokerage brand vibe (Coldwell vs. KW vs. Compass color palettes). Won't drive layout. |
| **(e) Hybrid: image generates background, code overlays text** | **CHOSEN** | The only approach that gets the phone number rendered byte-perfect every time. Side-steps the entire text-rendering problem. |
| **(f) LLM-planner → image-executor** | **CHOSEN (paired with e)** | This IS the "RAG for images" answer. LLM holds the design KB; image model only does pixels. |
| (g) Fine-tuned model | Reject for MVP | $5–20K training cost, narrow lift over (e+f), no consistency win over programmatic typography. Revisit at >1000 signs/mo. |

## 3. How production design products actually solve this

None of the platforms Tanner referenced use raw text-to-image for finished output:

- **Canva Magic Design** matches the prompt to a curated **template library** (8–10 layout variants), then swaps in brand-kit colors/fonts via a deterministic templating engine. The "AI" is layout selection + content fill, not pixel generation. Text is real DOM/SVG text, never rasterized by a model.
- **Looka / Brandmark** combine **template libraries with automation**; both explicitly described as "template-based" approaches that "ensure text renders correctly... unlike general-purpose AI image models" — they generate the icon mark with constrained models and composite typography in vector.
- **Vistaprint AI Logo Maker** generates icon marks but composites onto thousands of pre-vetted business-card templates.
- **Adobe Firefly Generative Fill** uses inpainting masks (technique c) but for photo editing, not finished print artifacts.

**The unanimous pattern: AI for the unconstrained parts (style, background, mood); deterministic templating for the constrained parts (text, layout, brand assets).** PPI should follow the same pattern.

## 4. Recommended architecture for PPI

### Data flow

```
[Agent Inputs]               [Design Rules KB]
- name, phone, license  ─┐   - font-size formulas (1in per 10ft)
- brokerage              │   - contrast pairs (8 vetted combos)
- headshot upload        │   - layout archetypes (4 templates)
- brand preference       │   - brokerage color overrides
                         ▼
              ┌──────────────────────┐
              │  LLM PLANNER         │  gpt-5 / claude-opus-4.7
              │  (Anthropic SDK,     │  - reads inputs + KB
              │   structured        │  - chooses template archetype
              │   output, Zod       │  - sizes fonts per legibility rule
              │   schema)           │  - picks contrast pair
              └──────────┬──────────┘
                         ▼
          ┌──────────────────────────────┐
          │ DesignSpec (JSON)            │  ← stored in Postgres,
          │ - templateId: "archetype-3"  │    versioned per regen
          │ - colors: {bg, text, accent} │
          │ - phoneFontPt: 220           │
          │ - nameFontPt: 96             │
          │ - layoutRegions: {...bbox}   │
          │ - backgroundPrompt: "..."    │
          └──────────┬───────────────────┘
                     ▼
        ┌────────────────────────┐  ┌──────────────────────┐
        │ IMAGE MODEL            │  │ HEADSHOT PIPELINE    │
        │ gpt-image-2 generates  │  │ - bg-remove (remove. │
        │ BACKGROUND ONLY        │  │   bg / sharp)        │
        │ (no text in prompt)    │  │ - color-grade match  │
        │ 1800×2400 @ 300dpi     │  │   to template palette│
        └──────────┬─────────────┘  └──────────┬───────────┘
                   └──────────┬────────────────┘
                              ▼
                   ┌──────────────────────┐
                   │ SVG COMPOSITOR       │  satori or @resvg/resvg-js
                   │ - place bg image     │  (already common in Next.js)
                   │ - place headshot     │
                   │ - render typography  │  ← real text, perfect render
                   │   at spec'd sizes    │
                   └──────────┬───────────┘
                              ▼
                   ┌──────────────────────┐
                   │ OCR VALIDATOR        │  Tesseract (open source)
                   │ - extract all text   │  or Google Vision
                   │ - diff vs DesignSpec │
                   │ - reject if phone/   │
                   │   name mismatch      │
                   └──────────┬───────────┘
                              ▼
                   ┌──────────────────────┐
                   │ AGENT PREVIEW + ADMIN│
                   │ APPROVAL             │  ← Ryan/admin gate
                   │ (regen budget: 3)    │
                   └──────────┬───────────┘
                              ▼
                  [Print API POST → CustomerSign row, sourceType='custom_designed']
```

### Why this architecture wins

1. **Byte-perfect text:** phone numbers and names are rendered by a font engine, not a transformer. Zero OCR drift.
2. **Deterministic layout:** the LLM-planner picks from 4 vetted archetypes; you can't get a layout that violates the legibility rule because the planner's JSON schema constrains font-size minimums by sign distance.
3. **Tasteful background variance:** the image model still does what it's good at — generating a non-generic background texture/scene that doesn't look like every other agent's sign.
4. **Cheap and fast:** GPT Image 2 background-only generation runs ~$0.04/image and ~6s; the LLM planner is ~$0.02 in tokens. A regen is ~$0.06, well under our cost ceiling.
5. **Validatable:** OCR step catches any compositor bug before print. Tesseract 5 LSTM hits 99%+ on the clean, high-contrast text we control.
6. **Brand-consistent:** the Design Rules KB encodes brokerage-specific palettes; same agent re-ordering 6 months later gets a visually consistent re-print.

### The KB (the actual "RAG" content)

Stored as TypeScript constants or a `DesignRule` Postgres table; NOT a vector store. Image generation doesn't benefit from semantic retrieval — it benefits from deterministic rules the planner consumes. Seed the KB from Researchers A+B's findings plus what we already have evidence for:

- **Legibility formula:** `minFontInches = readDistanceFeet / 10`. PPI signs read from ~70ft → minimum 7" for the dominant element (phone). Phone gets 220pt, name gets 96pt, brokerage gets 60pt.
- **Contrast pairs (8 vetted):** white-on-pink-PPI, navy-on-white, black-on-yellow, white-on-navy, etc. Each has a measured WCAG-AAA contrast ratio + a "tested in glare/dusk" flag.
- **Layout archetypes (4):** A) headshot-left + stacked-text-right; B) headshot-bottom-right + text-top-left; C) no-headshot + brokerage-logo-dominant; D) photo-of-property + agent-strip-bottom.
- **White space rule:** 30–40% negative space, enforced as max-text-bbox-area in the JSON schema.
- **Font whitelist:** Impact, Proxima Nova, Futura, Helvetica Bold — all licensed for commercial print. No serifs.
- **Banned elements** (planner must reject): drop shadows, gradients on text, italic phone numbers, more than 3 colors.

### Reference image retrieval — worth it?

**Honest answer: no, not for MVP.** True image-RAG (CLIP-embed our high-converting corpus, retrieve nearest neighbor as conditioning image) adds infrastructure (vector DB, embedding pipeline, image corpus we don't have yet) and gives us a marginal improvement over what the planner+template+style-prompt already delivers. The KB lookup IS the RAG step — it just retrieves from a structured rules table instead of an image corpus. Revisit once we have 200+ shipped signs and conversion data to identify which designs actually performed.

## 5. Specific prompts and parameters

**LLM Planner system prompt (skeleton):**
```
You are a real-estate sign design planner. Given agent inputs, return a
DesignSpec JSON matching the provided Zod schema. Enforce these rules:
- The phone number is the largest text element, minimum 200pt.
- The agent name is second-largest, 80-100pt.
- Use exactly one contrast pair from the approved list.
- Choose one layout archetype (A/B/C/D) based on whether a headshot was
  provided and brokerage branding strength.
- Total text bounding boxes must occupy ≤60% of canvas area.
- Background prompt must describe scene/texture only — never mention
  names, numbers, letters, or words.
```

**Image model prompt template (background only):**
```
{archetype.backgroundDescription}, {brokerage.colorPalette} color palette,
clean uncluttered composition with {archetype.emptyRegions} negative space
in the {archetype.textRegions} regions, professional real-estate aesthetic,
no text, no letters, no numbers, no words, no logos
```
Negative prompt: `text, letters, numbers, watermark, logo, signature`
Model: `gpt-image-2`, size `1024x1536`, quality `high`.

**OCR validation gate:**
```ts
const ocrResult = await tesseract.recognize(composited);
const expectedPhone = spec.phone.replace(/\D/g, '');
const ocrPhone = ocrResult.text.replace(/\D/g, '');
if (!ocrPhone.includes(expectedPhone)) throw new RenderValidationError();
```

## 6. Honest risks

- **Headshot color-grading mismatch:** AI-generated background palette may not harmonize with the agent's headshot lighting. Mitigation: run a color-grade pass on the headshot to match the dominant background hue before compositing.
- **"Looks AI-generated" backlash:** mitigated because the AI part is only the background texture, not the whole composition. Agents seeing the preview won't perceive it as "an AI sign" — they'll see a clean designed sign with a tasteful background.
- **gpt-image-2 producing text anyway:** even with "no text" negatives, models occasionally hallucinate text. Mitigation: a second OCR pass on the *background alone* before compositing — if Tesseract finds any text, regenerate the background.
- **Print vendor color profile drift:** CMYK conversion can shift the carefully-chosen contrast pair. Mitigation: pre-validate contrast ratio after CMYK conversion in the compositor.

## Recommendation: GO, with the architecture above

This is shippable in ~3–4 weeks: planner + 4 archetypes + satori compositor + Tesseract validator + admin approval queue. The "hard engineering question" Tanner flagged dissolves once we stop asking the image model to do design and start asking it to do textured backgrounds — which it's actually good at.

---

**Sources:**
- [Text-to-Image AI Tested and Ranked 2026 — nestcontent.com](https://nestcontent.com/blog/text-to-image-ai)
- [Ideogram 4.0 Released — kombitz.com](https://www.kombitz.com/2026/06/04/ideogram-4-0-released-open-weight-ai-image-model/)
- [Best AI Image Editing Models 2026 — atlascloud.ai](https://www.atlascloud.ai/blog/guides/best-ai-image-editing-models-2026)
- [GPT Image 1 API Pricing & Editing Guide — EvoLink](https://evolink.ai/blog/gpt-image-1-api-guide-pricing-features-2026)
- [GPT Image generation prompting guide — OpenAI](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- [Image editing/inpainting with a mask for gpt-image-1 — OpenAI Community](https://community.openai.com/t/image-editing-inpainting-with-a-mask-for-gpt-image-1-replaces-the-entire-image/1244275)
- [Magic Design — Canva](https://www.canva.com/magic-design/)
- [Canva AI Features in 2026 — sawankr.com](https://sawankr.com/courses/canva/canva-ai-features-2026-magic-studio-guide)
- [Looka — How it works](https://looka.com/logo-maker/how-it-works/)
- [Best AI Logo Generators 2026 — aitoolclaw.com](https://aitoolclaw.com/articles/best-ai-logo-generators/)
- [How to Use AI for Small Business Design — VistaPrint](https://www.vistaprint.com/hub/ai-for-small-business-design)
- [AI Image Prompting: JSON Structure, Reference Images — vicsee.com](https://vicsee.com/blog/ai-image-prompting)
- [LLM Structured Output in 2026 — dev.to](https://dev.to/pockit_tools/llm-structured-output-in-2026-stop-parsing-json-with-regex-and-do-it-right-34pk)
- [Reliable JSON from Any LLM: Pydantic + Zod 2026 — techsy.io](https://techsy.io/en/blog/llm-structured-outputs-guide)
- [Design Tips for Real Estate Yard Signs — PrintPlace](https://www.printplace.com/blog/design-tips-and-best-practices-for-real-estate-yard-signs/)
- [Yard Sign Font Size & Layout Rules — uzmarketing.com](https://uzmarketing.com/en/yard-signs/yard-sign-font-size-layout-rules.html)
- [Real Estate Sign Colors & Fonts — customsigncenter.com](https://customsigncenter.com/blog/index.php/2026/01/23/real-estate-sign-colors-fonts/)
- [Enhancing Yard Sign Legibility — Denver Printing Company](https://www.denverprintingcompany.com/yard-signs/enhancing-yard-sign-legibility-design-principles/)
- [Tesseract OCR in 2026 — Medium](https://medium.com/intelligent-document-insights/tesseract-ocr-265dc2f88992)
- [Tesseract vs EasyOCR vs OpenAI: Accuracy 2026 — ttsforfree.com](https://ttsforfree.com/en/blogs/image-to-text-python-tesseract-vs-easyocr/)