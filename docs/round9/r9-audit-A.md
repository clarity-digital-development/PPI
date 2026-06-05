All suspicions confirmed with evidence. Returning the audit.

---

# Auditor A — /dashboard/profile audit

**Files audited:** `app/dashboard/profile/page.tsx` (226 lines, full read), `app/api/profile/route.ts` (83 lines, full read), `prisma/schema.prisma` (grep), `lib/email.ts` (grep).

**TL;DR:** Page has two cards. Card 1 (Profile Information) is fully wired and works. Card 2 (Notification Preferences) is 100% decorative — confirmed. No password-change form exists on this page at all.

---

## Card 1 — "Profile Information" (page.tsx:103-179)

| # | Field / Control | UI shape | What it actually does | Verdict | Evidence |
|---|---|---|---|---|---|
| 1.1 | Card heading "Profile Information" | `<h2>` | Static label | WORKS | page.tsx:107-109 |
| 1.2 | "Edit Profile" button | outline Button, top-right | `setIsEditing(true)` — toggles all inputs from `disabled` to editable and reveals Save/Cancel | WORKS | page.tsx:110-114 |
| 1.3 | Full Name input | text Input w/ User icon | Controlled by `formData.fullName`, onChange updates state (page.tsx:122-124); on Save sent in PUT body and persisted via `prisma.user.update({ data: { fullName } })` | WORKS | page.tsx:118-126; route.ts:59-66 |
| 1.4 | Email Address input | email Input, **always `disabled`**, helper text "Email cannot be changed" | Display-only. PUT body never includes `email`; Zod schema (route.ts:6-10) doesn't allow it; ignored even if sent | WORKS as intended (read-only by design) | page.tsx:128-135; route.ts:6-10, 59 |
| 1.5 | Phone Number input | tel Input w/ Phone icon | Controlled, onChange wired (page.tsx:142-144); persisted to `user.phone` on Save | WORKS | page.tsx:137-147; route.ts:65 |
| 1.6 | Company / Brokerage input | text Input w/ Building icon | Controlled, onChange wired (page.tsx:153-155); persisted to `user.company` on Save | WORKS | page.tsx:149-158; route.ts:66 |
| 1.7 | "Save Changes" button | primary Button, only when editing | Calls `handleSave` → `PUT /api/profile` with `{fullName, phone, company}`, on 200 updates local `profile` and exits edit mode; spinner while in-flight | WORKS | page.tsx:52-75, 161-172 |
| 1.8 | "Cancel" button | outline Button | Resets `formData` from `profile` snapshot, exits edit mode. No API call. | WORKS | page.tsx:77-85, 173-175 |
| 1.9 | Loading spinner | Loader2 | Shown while initial GET in flight (page.tsx:87-96) | WORKS | page.tsx:28-50, 87-96 |

**API side (`app/api/profile/route.ts`):**
- `GET` — auth-gated via `getCurrentUser()` (route.ts:14-18), returns `{ profile, user }` with id/email/fullName/phone/company/role/teamId. Note it returns the SAME object under both keys (route.ts:33-34 comment) — fine but slightly redundant.
- `PUT` — auth-gated (route.ts:43-47), Zod-validated (route.ts:50-57), persists only `fullName/phone/company`. **No audit log call** — silent profile changes (e.g., team_admin renaming themselves, or PII swap) leave no audit trail. Low-sev finding.
- **No DELETE, no PATCH** — fine; nothing on the page needs them.
- **No password endpoint exists in this folder.**

**Card 1 issues found:**
- **L1 (low):** Profile updates not written to `auditLog` — every other mutation in the app audits; this one doesn't. (route.ts:61-75)
- **L2 (low):** PUT returns no `success` flag; UI just checks `res.ok` (page.tsx:65) — fine, but on non-ok there's NO user-visible error toast or message, the user is left in edit mode silently (page.tsx:65-74 — no else branch, no setError state).
- **L3 (cosmetic):** Phone has no format/length validation client- or server-side; `z.string().optional()` accepts anything including empty string and emoji (route.ts:8).

---

## Card 2 — "Notification Preferences" (page.tsx:181-221) — **THE HEADLINE BUG**

| # | Checkbox label | What user thinks it does | What it actually does | Verdict | Evidence |
|---|---|---|---|---|---|
| 2.1 | "Email notifications for new orders" | Opt out of new-order emails | **NOTHING.** `<input type="checkbox" defaultChecked={true}>` with NO `onChange`, NO `checked` prop, NO state, NO API. Clicking flips the local DOM state; on refresh it resets to true. | **DECORATIVE** | page.tsx:189-217 |
| 2.2 | "SMS notifications for installation updates" | Opt out of install SMS | Same — pure DOM checkbox, no handler | **DECORATIVE** | page.tsx:194-197, 211-215 |
| 2.3 | "Email notifications for order confirmations" | Opt out of confirmations | Same — pure DOM checkbox, no handler | **DECORATIVE** | page.tsx:198-201, 211-215 |
| 2.4 | "Marketing emails and promotions" | Opt out of marketing | Same — pure DOM checkbox, no handler. (Also note default is `false` so unchecking it is a no-op visually too.) | **DECORATIVE** | page.tsx:202-205, 211-215 |

**Hard evidence the prefs are not wired anywhere:**
- **No state for prefs** — `useState` block only tracks `isEditing/loading/saving/profile/formData(name/email/phone/company)` (page.tsx:17-26).
- **No handler** — the `<input>` (page.tsx:211-215) has only `type`, `defaultChecked`, `className`. No `onChange`, no `checked`.
- **No "Save Preferences" button** — entire card has no Button element at all (page.tsx:181-221).
- **No DB column** — grep for `notificationPref|emailNotif|smsNotif|marketingEmail|emailOptOut|unsubscribe|preference` in `prisma/schema.prisma` returns **zero matches**. There is nowhere to persist these flags.
- **No API endpoint** — only handlers in `app/api/profile/route.ts` are `GET` (route.ts:12-39) and `PUT` (route.ts:41-82); neither reads or writes any pref field. Zod schema (route.ts:6-10) only allows `fullName/phone/company`.
- **No email-send gating** — grep for `notificationPref|emailNotif|optOut|unsubscribe|preference` (case-insensitive) in `lib/email.ts` returns **zero matches**. Every email-send path (SR confirm, SR status changes, order confirm, refund, admin notify) fires unconditionally. Peggy's team CANNOT opt out via this UI.

**What's missing to make this real (full list):**
1. Add `prisma/schema.prisma` columns on `User` — e.g. `notifyOrderEmails Boolean @default(true)`, `notifySmsUpdates Boolean @default(true)`, `notifyOrderConfirmations Boolean @default(true)`, `notifyMarketingEmails Boolean @default(false)`. Migration.
2. Extend `GET /api/profile` select (route.ts:22-30) and `PUT` Zod schema (route.ts:6-10) + update payload (route.ts:64-66) to include these four flags.
3. In `page.tsx`: add `useState` for prefs, hydrate from GET response, replace `defaultChecked` with `checked={prefs.x}` + `onChange` (page.tsx:211-215), add a "Save Preferences" button calling `PUT /api/profile`.
4. In every send path in `lib/email.ts` (and the SMS sender, wherever it lives), look up the recipient `User` and short-circuit when the relevant flag is false. Marketing flag must default false (CAN-SPAM-adjacent prudence). Transactional emails (order confirmation, refund) should arguably remain force-sent regardless — that's a product call; right now there's no way to even ask the question.
5. Add `audit()` calls on preference changes so we can prove who turned what off (defending against "but I didn't get the email" disputes).
6. Add an unsubscribe link / token-based one-click opt-out in the email footer for marketing emails (CAN-SPAM compliance gap — separate issue, not on this page).

---

## Password change form

**Does not exist on this page.** Grep for `password|Password` in `app/dashboard/profile/page.tsx` returns **zero matches** (page.tsx 1-226). There is no change-password card, no API call to anything like `/api/auth/change-password` from this page, nothing. If users need to change their password they must do it through some other flow (forgot-password reset, presumably) — out of scope for this audit but worth flagging as a missing-feature gap on profile.

---

## Summary verdict

- **Card 1 (Profile Information):** WORKS end-to-end. Minor polish issues (no audit log on update, no error toast on PUT failure, no phone validation). All four editable fields persist to `user` table correctly.
- **Card 2 (Notification Preferences):** **100% DECORATIVE.** All four checkboxes are unwired DOM elements. No state, no handler, no Save button, no API field, no DB column, no email-send gating. Peggy's team's complaint is correct — toggling these does literally nothing, and they cannot reduce email volume from this UI today. This is a real-customer-impacting bug, not just a cosmetic one.
- **Password change:** Not present on this page at all.

**Files referenced (absolute):**
- `C:\Users\tanne\PPI\app\dashboard\profile\page.tsx`
- `C:\Users\tanne\PPI\app\api\profile\route.ts`
- `C:\Users\tanne\PPI\prisma\schema.prisma` (no pref columns)
- `C:\Users\tanne\PPI\lib\email.ts` (no pref gating)