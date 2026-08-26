# Installer dispatch email — design

**Status:** approved-for-build pending Tanner sign-off · **Requested:** Ryan, Slack 2026-08-25 · **Spec'd:** 2026-08-25 (explore → design → adversarial critique; critique's must-fixes folded in below)

## What Ryan asked for

> "having the ability to send an email on the orders and service requests for the day to our installers … I can click on or select each order that I want to email for them to complete. Then I can type the email for it to go to. This email should have all the order details EXCEPT the pricing. So the address, agent name, date, and what they want installed."

Motivation: he forwards customer-facing order emails to hourly installers today; one saw the $80 line and concluded he was underpaid. **The email must never contain a price, total, fee, or per-item amount.**

## Verified premises (file:line)

- Admin-only route pattern: `getCurrentUser()` + `role !== 'admin'` → 401/403 (`app/api/admin/orders/route.ts:7-15`). **Plus** `middleware.ts:44-46,62` already blocks non-admin JWTs from `/api/admin/*`, and `/admin` pages are gated at `middleware.ts:12-16` + `app/admin/layout.tsx:44-58`. team_admin never reaches this feature — correct, it carries gate codes and lockbox codes.
- Resend wrapper `getResend()` (`lib/email.ts:85-96`); `from 'Pink Posts Installations <orders@pinkposts.com>'`, `reply_to contact@pinkposts.com` (`:506-509`); `to` accepts `string[]`.
- The closest template, `sendAdminOrderNotification` (`lib/email.ts:333-522`), already assembles every installer-relevant field at `:399-427` — but interleaves prices at `:375, :378-397, :429-479, :500-501`. **Not reused** — a `hidePrices` flag on it is one missed branch away from a leak.
- Module-private helpers reusable from inside `lib/email.ts`: `ExistingLockboxSummary` (`:722-726`), `formatExistingLockboxLine` (`:729`), `renderExistingLockboxesHtml` (`:749`), `labelRequestType` (`:875`), `escapeHtml` (`:1283`), HTML shell `:181-192/258-262`, yellow notes block `:231-236`.
- Existing-lockbox summary assembly (live `CustomerLockbox.code/serialNumber`, fallback `InstallationLockbox.code`): `app/api/service-requests/route.ts:69-76`.
- Only multi-select precedent in `/admin`: `app/admin/customers/[id]/page.tsx:145, 404-416, 1068-1071, 1510-1538` (selection Set, native checkboxes, fixed-bottom bar).
- Dates: `Order.scheduledDate` is noon UTC from customer/batch/reschedule paths (`app/api/orders/route.ts:535`, `batch/route.ts:443`) **but midnight UTC from the admin PUT** (`app/api/admin/orders/[id]/route.ts:171`); SR `requestedDate` noon UTC (`service-requests/route.ts:33`, `admin/service-requests/[id]/route.ts:114`). A `[T00:00:00Z, T23:59:59.999Z]` window + `timeZone:'UTC'` formatting covers both — do not "optimise" to noon-only.
- `installationLocationImage` is a base64 data URI up to 5 MB (`prisma/schema.prisma:407`, `property-step.tsx:62-71`), no server cap.
- `OrderItem.description` is client-supplied verbatim (`lib/validations.ts:24` → `app/api/orders/route.ts:565`); quantities are usually baked into the description ("Wire Frame Sign Install × 2") with `quantity` = 1.
- Stock rider named **"Price Reduced"** (`components/order-flow/RiderSelector/constants.ts:62`; seed has "PRICE IMPROVED") lands in descriptions — a naive money-word guard would refuse legitimate sends.
- No "installer" concept anywhere in schema/env (only the `installer_decides` orientation value). No test runner (`package.json`).

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Three allowlists, never a blocklist.** (a) Prisma `select` objects naming only installer fields — money columns are never fetched; (b) a DTO type with no money fields; (c) runtime `assertNoMoney()` on the rendered output. | Structural guarantee. A blocklist leaks on the next new column. |
| D2 | **Runtime guard asserts only `/\$\s?\d/` and spelled amounts (`/\b\d[\d,]*(\.\d+)?\s?(dollars|bucks|usd)\b/i`)** after `redactMoney()` runs over **every** string field of the DTO (notes, descriptions, gate code, install location, orientation-other, agent name/company, address lines, lockbox codes, Ryan's note). The money-**word** check (`price|fee|total|invoice|…`) lives only in the no-DB regression script, scanning the template's static literals. | Critique: "Price Reduced" rider, an agent surnamed Price, "Total Realty", Price Rd would all 500 a real send. Redaction must be uniform or the fatal assert fires on a field nobody redacted. |
| D3 | **One email, both job kinds, per-tab selection** in `sessionStorage`. Ryan ticks orders, clicks Service Requests, ticks trips, sends once. | `sessionStorage` is per-tab by definition — no cross-tab sync claims (critique). Dies with the tab, which is right for a 7am one-person workflow. |
| D4 | **Recipient memory in the modal's `localStorage`** (last-used list + recent chips). Audit rows are still written per send, but the product feature does not read them back. | `audit()` swallows failures (`lib/audit.ts:43-63`); mining it for a feature is fragile. No schema. |
| D5 | **New-address confirm.** Sending to any address not in the recent list requires an explicit "Send to a new address?" confirm. | Gate + lockbox codes to a stranger is the worst outcome and there is no recall. |
| D6 | **Preview is the real render** (`dryRun: true` runs the exact loader + template). Rendered once on modal open; dryRun allowed with zero recipients ("To: (none yet)"). | What Ryan reads is byte-for-byte what goes out. No debounce churn. |
| D7 | **Photo: link, not attachment, in v1.** Job block says "Photo on file: <admin order link>". | Removes a 5 MB × 50-order memory hazard from the loader select and Gmail data-URI stripping. Attachments only if Ryan says yes (open question). |
| D8 | **Send synchronously.** Resend failure → 502 + `dispatch.email.failed` audit. | Ryan is standing there at 7am. |
| D9 | **Cancelled jobs skipped server-side, listed as "will be skipped"** in preview; completed jobs sent but flagged "(already marked completed)". Never any payment-status hint. | Mirrors "Do not dispatch" (`lib/email.ts:812`). Payment words are exactly what must stay away from the crew. |
| D10 | **Date filter on both lists, URL-only.** `scheduled_date` / `requested_date` = `YYYY-MM-DD` or `unscheduled`. Only the `unscheduled` literal may persist to localStorage. | Persisting a concrete date replays yesterday every morning and shows "No orders found" (critique; same reason `page` isn't persisted, `orders/page.tsx:148-150`). |
| D11 | **"Sent to crew" badge deferred.** Audit rows are written per job so it can be added later without backfill. | Cut v1 scope; ask Ryan. |
| D12 | **HTML body capped:** text-only above 40 jobs; hard cap 50 jobs/send, 10 recipients. | Gmail clips HTML > ~102 KB. |

## Schema

None. Persistence = rows in `audit_logs`: one `dispatch.email.sent` summary row (`targetType 'dispatch'`, metadata: recipients, orderIds, orderNumbers, serviceRequestIds, jobCount, skipped, subject, resendId) + one row per job (`targetType 'order'|'service_request'`, `targetId`). `dispatch.email.failed` on money-guard or Resend failure.

## lib

### `lib/dispatch/types.ts` (new)
```ts
export const INSTALLABLE_ITEM_TYPES = ['post','sign','rider','lockbox','brochure_box','wire_frame_sign','solar_lighting','second_post','trip'] as const
// 'surcharge' deliberately absent — the server-injected "Out of Area Service Fee" (app/api/orders/route.ts:238-268)

interface DispatchLine { description: string; quantity: number }
interface DispatchLockbox { type: string; serialNumber: string | null; code: string | null }
interface DispatchOrderJob { kind:'order'; id; orderNumber; status; address{line1,city,state,zip}; mapsUrl; scheduledDate: string|null; isExpedited; agent{name,phone,company}; soldBy{name,phone}|null; postType: string|null; propertyType; installLocation; orientation; isGated; gateCode; markerPlaced; notes; lines: DispatchLine[]; photoUrl: string|null }
interface DispatchServiceJob { kind:'service_request'; id; status; type; address{…, unlisted}; mapsUrl; requestedDate; agent; description; notes; installedHere{orderNumber, lines}|null; ridersOnSite: string[]; lockboxesOnSite: DispatchLockbox[] }
export function redactMoney(s: string|null|undefined): string|null   // "$80" → "[amount removed]"; "80 dollars" → "[amount removed]"
export function redactAllStrings<T>(dto: T): T                          // walks every string field
export function assertNoMoney(r: {subject,text,html}): void            // throws on /\$\s?\d/ or spelled amounts ONLY
```
The DTO's only `number` field is `quantity` — the type is the second allowlist.

### `lib/dispatch/load-jobs.ts` (new) — the only place Prisma is touched
`DISPATCH_ORDER_SELECT` / `DISPATCH_SR_SELECT` (`satisfies Prisma.OrderSelect / ServiceRequestSelect`) naming only installer fields. **Not selected by construction:** every Order money column (`schema.prisma:422-453, 456, 459-461, 481, 506-555`), `OrderItem.unitPrice/totalPrice`, `PostType.price`, `ServiceRequest.invoice*`, `adminNotes`, `installationLocationImage` (D7 — link instead).

`loadDispatchJobs({orderIds, serviceRequestIds}) → { jobs, skipped }`: two `findMany({ where: { id: { in } }, select })`; `status === 'cancelled'` → skipped; unknown ids → skipped `not_found`. Order job: agent = `user.fullName || name || email`; `soldBy = resolveAssignedAgent(...)` (`lib/orders/assigned-agent.ts:13`); orientation label per `app/admin/orders/[id]/page.tsx:712-714`; `lines` = description + quantity (append `× qty` **only when quantity > 1**); `photoUrl` = `/admin/orders/{id}` when an image exists. SR job: address from installation else unlisted; strip the `[Unlisted Address: …]` suffix from `description` (`service-requests/route.ts:97-99`) when unlisted fields are present; wording "address not on file with PPI" (never "trip fee applies"); `lockboxesOnSite` exactly as `service-requests/route.ts:70-76`; `installedHere` for all SR types. Then `redactAllStrings()`. Sort: dated first ascending, then undated; tie-break `address.line1`. Cap 50.

### `lib/email.ts` — add after `sendAdminServiceRequestNotification`
`renderInstallerDispatchEmail(props) → { subject, text, html }` — pure, exported, calls `assertNoMoney()` on its own output. No `shouldSendEmail` (admin/system mail, `lib/email-preferences.ts:25-27`). Subject: `${anyExpedited ? '⚡ ' : ''}Install schedule — ${sameDate ? 'Mon, Aug 25' : 'multiple dates'} (${n} jobs)`. Text body per job:
```
================================================================
1) 123 Main St, Lexington KY 40507        ⚡ EXPEDITED
   Map: https://www.google.com/maps/search/?api=1&query=…
   Date: Monday, August 25
   Agent: Jane Doe (859-555-0100) · Keller Williams
   Sold by: Bob Smith (859-555-0101)
   Post: Standard Post
   Install:
     - Sign Install: 24x36 KW (from storage)
     - Rider Install: Coming Soon (from storage)
     - Sentrilock/Supra Install — Serial: 12345 · Code: 9876
   Location: left of driveway near mailbox
   Orientation: perpendicular · Marker placed: yes
   Gate code: 4321
   Notes: …
   Photo on file: https://pinkposts.com/admin/orders/…
```
SR block: `— SERVICE TRIP: Removal`, Request, Notes, "What was installed here (PPI-XXXX)", "Riders on site", "Lockboxes on site" via `formatExistingLockboxLine`. Footer: "Details as of <ts> ET — sent by <name>. Reply to this email if anything is unclear." HTML: shell `:181-192/258-262`, one card per job, address linked to maps, items as a 2-column Item/Qty table (no price column, no tfoot), all user text through `escapeHtml`. `sendInstallerDispatchEmail(props)` → Resend send, returns id.

### `lib/audit.ts`
`DispatchEmailSent: 'dispatch.email.sent'`, `DispatchEmailFailed: 'dispatch.email.failed'`.

## API

### `POST /api/admin/dispatch/email` (new)
Body `{ orderIds?, serviceRequestIds?, recipients, note?, dryRun? }`. Admin auth (`orders/route.ts:7-15` pattern; middleware is the first layer). Validate: ids deduped, 1..50 total; recipients trimmed/lowercased/deduped, each `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (`resend/route.ts:45`), 0..10 for dryRun, 1..10 for send; note ≤ 2000. → `loadDispatchJobs` (0 jobs → 400 with `skipped`) → `renderInstallerDispatchEmail` (guard throws → 500 "Refused to send: the email body contained a dollar amount. Nothing was sent." + failed audit `reason: 'money_guard'`) → dryRun returns `{ preview: { subject, text, to }, jobs: summaries, skipped }` → else send, audit summary + per-job rows, 200 `{ ok, sentTo, jobCount, skipped, resendId }`.

### `app/api/admin/orders/route.ts`
`scheduled_date` param (`unscheduled` → `scheduledDate: null`; `YYYY-MM-DD` → UTC-day window); when present, `orderBy [isExpedited desc, scheduledDate asc, propertyAddress asc]`.

### `app/api/admin/service-requests/route.ts`
`requested_date` param, same rules on `requestedDate`; date-filtered `orderBy [requestedDate asc, createdAt desc]`. Include tree unchanged.

## UI

- `components/admin/dispatch/useDispatchSelection.ts` — sessionStorage-backed `{ orderIds, serviceRequestIds, toggle*, setMany, clear, count }` with the try/catch pattern from `orders/page.tsx:20-45`. Per-tab.
- `components/admin/dispatch/DispatchBar.tsx` — fixed-bottom bar (`customers/[id]/page.tsx:1510-1538` pattern): "{n} orders + {m} service requests selected · Email installers · Clear".
- `components/admin/dispatch/DispatchEmailModal.tsx` — `Modal max-w-2xl`: To (Input, comma/space split; localStorage last-used pre-fill + recent chips; inline regex errors; **new-address confirm**), optional note textarea, preview (dryRun once on open: job summaries, "will be skipped" list, plain-text body in `<pre>`), Send (disabled while in flight / no valid recipients; success shows "Sent to a@x.com (6 jobs)", clears selection, calls `onSent`).
- `app/admin/orders/page.tsx` — `date` URL param (+ `DateInput` and "Unscheduled" toggle in the filter row); leading checkbox column with header select-all (indeterminate pattern `customers/[id]/page.tsx:955-957`), disabled on cancelled rows; `colSpan` 7→8; mount bar + modal with a `reloadKey` refetch.
- `app/admin/service-requests/page.tsx` — `filterDate` state → `requested_date` param; `DateInput` + "Unscheduled" in the Filters card; checkbox in each card header (`stopPropagation`, disabled on cancelled); mount bar + modal with `onSent={fetchRequests}`.

## Regression script — `scripts/_dispatch-email-preview.ts`
No DB. Fixture with two order jobs + two SR jobs whose free text is stuffed with `$80`, `total $1,234.56`, `80 dollars`, "Price Reduced" rider, a company "Total Realty". Calls `renderInstallerDispatchEmail`, prints the text body, exits non-zero if any `/\$\s?\d/` survives OR if the template's **static literals** contain a money word. Run before every template change.

## Security / privacy
- Two auth layers (middleware JWT + DB-backed `getCurrentUser`); team_admin 403.
- Leaves the system: agent name/phone/company, property address, gate code, lockbox codes/serials, notes — all already in the admin emails Ryan forwards today. Never leaves: any money column, payment/invoice status, `adminNotes`, customer email addresses.
- Mistyped recipient: regex, ≤10, remembered chips, new-address confirm, To: line in preview, full audit (actor, IP, UA, recipients, job ids). No recall — residual risk disclosed to Ryan.
- HTML: `escapeHtml` on every user string; maps URL via `encodeURIComponent`.
- `.env.local` = live Resend: QA via `dryRun` + the no-DB script; real sends only to Tanner/Ryan.

## Ship order
1. `lib/audit.ts` constants → 2. `lib/dispatch/types.ts` + `load-jobs.ts` → 3. `lib/email.ts` renderer + sender → 4. regression script (must pass) → 5. `POST /api/admin/dispatch/email` → 6. list-API date filters → 7. `components/admin/dispatch/*` → 8. orders page → 9. SR page → 10. adversarial review (money guard; code disclosure to a mistyped address) → 11. ship + plain-English Slack note.

## Open questions for Ryan
1. Location photo: link to the admin page (v1) or attached to the email?
2. A small "Sent to crew Aug 25" tag on jobs you've already emailed — want it?
3. Confirm the crew email shows the agent's name and phone (and "Sold by" for team accounts). No customer emails, no prices.
4. When an order is cancelled after you've already emailed it: automatic "CANCELLED — do not install" follow-up, or text as today? (Not v1.)

## Effort
~1 focused day (lib 3h, routes 2h, UI 3h, script + QA + review 2h). No schema, no Stripe.


## Status — shipped 2026-08-25

Ryan's answers to the open questions (Slack thread, 2026-08-25):

1. **Photos: attached**, not linked. Loader fetches `installationLocationImage` one order at a time (never in the list select), caps 3 MB per photo / 15 MB per email, and prints a "see the admin order page" note when a photo is over budget. Sent to Resend as base64 strings (a Buffer JSON-serializes to ~4x its size).
2. **No "sent to crew" badge** on the order — audit log rows only (`dispatch.email.sent` per job + one summary row carrying the Resend id).
3. **Agent details: yes** — name, phone, company, plus "Sold by" for team orders.
4. **No cancel follow-up** — a cancelled job is simply skipped (and listed as skipped in the preview).

Changes from the spec found by the pre-ship adversarial review:

- Money guard covers **amounts in every spelling** — `$80`, `$ 80`, `80$`, `USD 80`, `80 dollars`, `80-dollar`, `eighty dollars`, `€/£`. Patterns live in `lib/dispatch/money.ts` (Buffer-free) and are shared by the redactor, the send-time backstop, the admin note, and the modal preview. Still amounts only — "Price Reduced" survives.
- The dashboard trip modal bakes `… Address: X. Trip fee: $40` into every service-trip description; the loader now **strips that suffix** rather than redacting it (a `Trip fee: [amount removed]` line still tells the crew a charge exists).
- The email body has **no "To:" line** (mail client shows recipients; the preview is rendered before the final list is typed). The modal splices the typed, redacted note into the preview at the exact spot the template puts it, so preview == sent.
- Modal: stale dryRun responses are discarded on close/reopen; backdrop/X are inert mid-send; a note containing an amount shows a hint that it will be replaced.
- Regression script `scripts/dispatch-email-preview.ts` (no DB, no network) exercises all of the above — run it before touching the template.
