# Pink Posts — Branded PDF Styling

Reusable recipe for generating client-facing PDFs (changelogs, updates, one-pagers)
that match the look of the Pink Posts invoices/emails. Copy this file to any machine;
the generator at the bottom is self-contained (needs only Node + Playwright).

---

## Brand palette

| Role | Hex | Used for |
|---|---|---|
| **Primary pink** | `#E84A7A` | Headings, number badges, card top-border, label text, logo wordmark |
| **Pink-tint background** | `#FFF0F3` | Page background (full-bleed) |
| **Card white** | `#FFFFFF` | Content cards |
| **Hairline** | `#F3E1E8` | Divider inside cards |
| **Heading text** | `#111827` | Card titles |
| **Body text** | `#4B5563` | Paragraphs |
| **Bold/emphasis text** | `#374151` | `<b>` runs |
| **Muted text** | `#9CA3AF` | Date line, footer |

Accent colors from the same brand system (use sparingly, e.g. callouts):
amber `#F59E0B` / `#FFFBEB` / `#92400E` (warnings), blue `#1E3A8A` / `#EFF6FF` / `#DBEAFE` (info).

## Typography
- **Font:** Poppins (weights 400/500/600/700), loaded from Google Fonts; fallback `Arial, sans-serif`.
- Title ~30px/700, card titles ~17px/600, body ~14px, small/labels ~13px.

## Layout principles
- Full-bleed `#FFF0F3` page background (set PDF margins to 0 + `printBackground: true`).
- Centered content column, `max-width: 760px`, ~40px page padding.
- Header: centered logo (~46px tall) → pink H1 → muted date line.
- Each section is a **white rounded card** (`border-radius: 12px`, soft shadow,
  **3px pink top border**), with a pink **number badge** (30px circle), a title, a body
  paragraph, then `label → value` rows (pink labels).
- `page-break-inside: avoid` on cards so they don't split across pages.
- Letter size; embed the logo as base64 so the file is portable.

---

## CSS (drop-in `<style>`)

```css
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Poppins', Arial, sans-serif; margin: 0; background: #FFF0F3; color: #374151; }
.page { max-width: 760px; margin: 0 auto; padding: 40px 36px 28px; }
.header { text-align: center; margin-bottom: 26px; }
.header img { height: 46px; margin-bottom: 14px; }
.header h1 { color: #E84A7A; margin: 0; font-size: 30px; font-weight: 700; }
.header .date { color: #9CA3AF; margin: 6px 0 0; font-size: 14px; }
.intro { background: #fff; border-radius: 12px; padding: 18px 22px; box-shadow: 0 2px 8px rgba(0,0,0,.06); font-size: 14.5px; margin-bottom: 18px; }
.card { background: #fff; border-radius: 12px; padding: 22px 24px; box-shadow: 0 2px 8px rgba(0,0,0,.06); margin-bottom: 16px; page-break-inside: avoid; border-top: 3px solid #E84A7A; }
.card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.num { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 50%; background: #E84A7A; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 15px; }
.card h2 { font-size: 17px; color: #111827; margin: 0; font-weight: 600; }
.body { font-size: 14px; line-height: 1.55; margin: 0 0 12px; color: #4B5563; }
.rows { border-top: 1px solid #F3E1E8; padding-top: 10px; }
.row { display: flex; gap: 12px; font-size: 13px; line-height: 1.5; margin-bottom: 7px; }
.row .k { flex: 0 0 110px; color: #E84A7A; font-weight: 600; }
.row .v { color: #4B5563; }
.footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 18px; }
b { color: #374151; font-weight: 600; }
```

---

## Reusable generator (Node + Playwright)

One-time setup on a new machine:

```bash
npm i -D playwright && npx playwright install chromium
```

Save as `make-pdf.js`, edit `TITLE` / `DATE` / `INTRO` / `items` / `OUT`, then run `node make-pdf.js`:

```js
const { chromium } = require('playwright')
const fs = require('fs')

// ---- EDIT THESE ----
const LOGO_PATH = 'public/images/logo.png'                 // path to the Pink Posts logo
const OUT       = require('os').homedir() + '/Downloads/Pink Posts - Update.pdf'
const TITLE     = "What’s New on Pink Posts"
const DATE      = 'Product update · June 23, 2026'
const INTRO     = 'Hi Ryan — here’s a plain-English rundown of what just went live.'
const items = [
  { n: 1, title: 'Section title', body: 'Plain-English description. Use <b>bold</b> for emphasis.',
    rows: [['Where', 'Admin &rarr; ...'], ['How', '...']] },
  // ...add more sections
]
// --------------------

const LOGO = fs.readFileSync(LOGO_PATH).toString('base64')
const card = (it) => `
  <div class="card">
    <div class="card-head"><div class="num">${it.n}</div><h2>${it.title}</h2></div>
    <p class="body">${it.body}</p>
    <div class="rows">${it.rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
  </div>`

const CSS = `* { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { font-family:'Poppins',Arial,sans-serif; margin:0; background:#FFF0F3; color:#374151; }
.page { max-width:760px; margin:0 auto; padding:40px 36px 28px; }
.header { text-align:center; margin-bottom:26px; }
.header img { height:46px; margin-bottom:14px; }
.header h1 { color:#E84A7A; margin:0; font-size:30px; font-weight:700; }
.header .date { color:#9CA3AF; margin:6px 0 0; font-size:14px; }
.intro { background:#fff; border-radius:12px; padding:18px 22px; box-shadow:0 2px 8px rgba(0,0,0,.06); font-size:14.5px; margin-bottom:18px; }
.card { background:#fff; border-radius:12px; padding:22px 24px; box-shadow:0 2px 8px rgba(0,0,0,.06); margin-bottom:16px; page-break-inside:avoid; border-top:3px solid #E84A7A; }
.card-head { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
.num { flex:0 0 30px; width:30px; height:30px; border-radius:50%; background:#E84A7A; color:#fff; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:15px; }
.card h2 { font-size:17px; color:#111827; margin:0; font-weight:600; }
.body { font-size:14px; line-height:1.55; margin:0 0 12px; color:#4B5563; }
.rows { border-top:1px solid #F3E1E8; padding-top:10px; }
.row { display:flex; gap:12px; font-size:13px; line-height:1.5; margin-bottom:7px; }
.row .k { flex:0 0 110px; color:#E84A7A; font-weight:600; }
.row .v { color:#4B5563; }
.footer { text-align:center; color:#9CA3AF; font-size:12px; margin-top:18px; }
b { color:#374151; font-weight:600; }`

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="page">
  <div class="header"><img src="data:image/png;base64,${LOGO}"><h1>${TITLE}</h1><p class="date">${DATE}</p></div>
  <div class="intro">${INTRO}</div>
  ${items.map(card).join('')}
  <div class="footer">Questions or want a tweak? Just say the word. &middot; Pink Posts Installations</div>
</div></body></html>`

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle' })   // networkidle = wait for the web font
  await page.pdf({ path: OUT, format: 'Letter', printBackground: true, margin: { top: '0in', bottom: '0in', left: '0in', right: '0in' } })
  await browser.close()
  console.log('PDF written:', OUT)
})()
```

### Notes / gotchas
- `printBackground: true` + page margins `0` are what make the pink background bleed to the edges.
- `waitUntil: 'networkidle'` ensures the Poppins web font is loaded before rendering (otherwise you get Arial).
- Embedding the logo as base64 keeps the PDF self-contained (no broken image if the path moves). The logo lives at `public/images/logo.png`.
- Output defaults to the OS Downloads folder via `os.homedir()`.
