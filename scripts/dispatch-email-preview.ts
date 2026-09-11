/**
 * Regression check for the installer dispatch email — no DB, no network.
 *
 * Renders a fixture whose free text is deliberately stuffed with money
 * ("paid $80 rush", "total $1,234.56", "80 dollars", the "Price Reduced"
 * rider, a company called "Total Realty") and fails if:
 *   - any dollar amount survives in the rendered text or html, or
 *   - a redaction marker is missing where one was expected, or
 *   - the template's OWN static copy uses a money word (the runtime guard
 *     deliberately does not check words — customer data legitimately
 *     contains "Price Reduced"; the template must not).
 *
 * Run before every change to the template:
 *   npx tsx scripts/dispatch-email-preview.ts
 */
import { renderInstallerDispatchEmail } from '../lib/email'
import { cleanServiceDescription } from '../lib/dispatch/load-jobs'
import { redactAllStrings, REDACTED, containsMoney, type DispatchJob } from '../lib/dispatch/types'

const jobs: DispatchJob[] = redactAllStrings<DispatchJob[]>([
  {
    kind: 'order',
    id: 'o1',
    orderNumber: 'PPI-TEST-0001',
    status: 'scheduled',
    address: { line1: '123 Price Rd', city: 'Lexington', state: 'KY', zip: '40507' },
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=123%20Price%20Rd',
    scheduledDate: '2026-08-25',
    isExpedited: true,
    agent: { name: 'Jane Price', phone: '859-555-0100', company: 'Total Realty' },
    soldBy: { name: 'Bob Smith', phone: null },
    postType: 'Standard Post',
    propertyType: 'residential',
    installLocation: 'left of driveway — customer paid $80 rush for this spot',
    orientation: 'perpendicular',
    isGated: true,
    gateCode: '$1234',
    markerPlaced: true,
    streetNumbersVisible: false,
    // Forms the 2026-08-25 review found leaking: 80$, USD 80, $  80,
    // 80-dollar, eighty dollars.
    notes: 'total $1,234.56 was quoted; also 80 dollars cash mentioned; crew got 80$ tip; USD 80 and $  80 and 80-dollar and eighty dollars said',
    lines: [
      { description: 'Rider Install: Price Reduced (from storage)', quantity: 1 },
      { description: 'Wire Frame Sign Install × 2 — $5 each by driveway', quantity: 1 },
      { description: 'Solar Lighting', quantity: 2 },
    ],
    // A stand-in photo so the inline-image wiring (cid ↔ attachment) is checked.
    photo: { filename: 'PPI-TEST-0001-location.jpg', content: Buffer.from('not-a-real-jpeg') },
    photoNote: null,
  },
  {
    kind: 'service_request',
    id: 's1',
    status: 'pending',
    type: 'Removal',
    address: { line1: '9 Main St', city: 'Richmond', state: 'KY', zip: '40475', unlisted: false, onFile: true },
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=9%20Main%20St',
    requestedDate: '2026-08-25',
    agent: { name: 'Semonin Support', phone: null, company: 'Semonin Realtors' },
    listingAgent: { name: 'Pat Team Agent', phone: '502-555-0142' },
    description: 'Remove sign — agent says the $40 was already paid',
    notes: null,
    installedHere: { orderNumber: 'PPI-TEST-0000', lines: [{ description: 'Black Vinyl Post (install & pickup)', quantity: 1 }] },
    ridersOnSite: ['For Sale', 'Price Reduced'],
    lockboxesOnSite: [{ type: 'Mechanical (Rental)', serialNumber: null, code: '1228' }],
  },
])

const rendered = renderInstallerDispatchEmail({
  recipients: ['crew@example.com'],
  jobs,
  note: 'Start with the expedited one. Do not discuss $ with the agent.',
  sentByName: 'Ryan',
  generatedAt: new Date('2026-08-25T11:02:00Z'),
})

let failed = false
const dollar = /\$\s?\d/
for (const [name, body] of Object.entries({ text: rendered.text, html: rendered.html, subject: rendered.subject })) {
  if (dollar.test(body)) { console.error(`FAIL: dollar amount survived in ${name}`); failed = true }
  if (containsMoney(body)) { console.error(`FAIL: money amount survived in ${name}`); failed = true }
}
for (const leak of ['80$', 'USD 80', '$  80', '80-dollar', 'eighty dollars', '80 dollars', '$1,234']) {
  if (rendered.text.includes(leak)) { console.error(`FAIL: "${leak}" survived in text`); failed = true }
}
// $80, $1,234.56, 80 dollars, 80$, USD 80, $  80, 80-dollar, eighty dollars,
// $1234 gate code, $5 each, $40 — "$ with" in the note is not an amount.
const expectedMarkers = 11
const markerCount = (rendered.text.match(new RegExp(REDACTED.replace(/[[\]]/g, '\\$&'), 'g')) || []).length
if (markerCount < expectedMarkers) { console.error(`FAIL: expected ≥${expectedMarkers} redaction markers in text, found ${markerCount}`); failed = true }
if (!/Price Reduced/.test(rendered.text)) { console.error('FAIL: legitimate "Price Reduced" rider was lost'); failed = true }
if (!/Total Realty/.test(rendered.text)) { console.error('FAIL: legitimate "Total Realty" company was lost'); failed = true }
if (/Trip fee/i.test(rendered.text)) { console.error('FAIL: "Trip fee" wording reached the crew'); failed = true }

// The photo must be embedded INSIDE its job card (Ryan 2026-09-08: plain
// attachments piled up at the bottom and read as the last job's), and the
// attachment must carry the matching Content-ID.
if (!rendered.html.includes('src="cid:photo-job-1"')) { console.error('FAIL: job 1 photo is not inlined in its card'); failed = true }
if (rendered.attachments.length !== 1 || rendered.attachments[0].contentId !== 'photo-job-1') {
  console.error(`FAIL: expected one attachment with contentId photo-job-1, got ${JSON.stringify(rendered.attachments.map((a) => a.contentId))}`); failed = true
}
// The cid must appear inside the first card, before the second job's title.
const cidAt = rendered.html.indexOf('cid:photo-job-1')
const secondJobAt = rendered.html.indexOf('SERVICE TRIP')
if (cidAt === -1 || secondJobAt === -1 || cidAt > secondJobAt) { console.error('FAIL: inline photo is not placed within job 1'); failed = true }

// Two-column layout: the label column is pinned narrow so long values can't be
// squeezed to one word per line on a phone (Ryan 2026-09-08, pic 3). No label
// may be nowrap'd, and the order number belongs in the value, not the label.
if (!rendered.html.includes('table-layout: fixed')) { console.error('FAIL: job table is not fixed-layout'); failed = true }
if (/white-space: nowrap/.test(rendered.html)) { console.error('FAIL: a nowrap label can still stretch column one'); failed = true }
if (!/<td width="120"/.test(rendered.html)) { console.error('FAIL: label column has no explicit width'); failed = true }
if (/>Installed here \(/.test(rendered.html)) { console.error('FAIL: order number is still inside the label cell'); failed = true }
if (!rendered.html.includes('>Installed here</td>')) { console.error('FAIL: "Installed here" label missing'); failed = true }

// The trip modal's app-composed "Address: … Trip fee: $40" suffix must be
// stripped by the loader, not merely redacted (a "[amount removed]" after
// "Trip fee:" still tells the crew a charge exists).
const cleanCases: Array<[string, boolean, string | null]> = [
  ['Service trip to add: lockbox: sentrilock, rider: Price Reduced. Address: 9 Main St, Richmond. Trip fee: $40', false, 'Service trip to add: lockbox: sentrilock, rider: Price Reduced'],
  ['Service trip — no items specified (pickup/visit only; admin to itemize). Address: 1 Elm St, Berea, KY 40403. Trip fee: $40\n\n[Unlisted Address: 1 Elm St, Berea, KY 40403]', true, 'Service trip — no items specified (pickup/visit only; admin to itemize)'],
  ['Remove the post and both riders', false, 'Remove the post and both riders'],
  ['', false, null],
]
for (const [input, unlisted, want] of cleanCases) {
  const got = cleanServiceDescription(input, unlisted)
  if (got !== want) { console.error(`FAIL: cleanServiceDescription(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); failed = true }
}

// Template static copy must not use money words. Strip customer data by
// rendering an empty-ish fixture and scanning what remains.
const bare = renderInstallerDispatchEmail({ recipients: [], jobs: [], note: null, sentByName: 'x', generatedAt: new Date() })
if (/\b(price|fee|total|invoice|surcharge|discount|tax|paid|charge)\b/i.test(bare.text + bare.html)) {
  console.error('FAIL: template static copy contains a money word'); failed = true
}

console.log(rendered.text)
console.log(`\nredaction markers: ${markerCount}, attachments: ${rendered.attachments.length}`)
console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS')
process.exit(failed ? 1 : 0)
