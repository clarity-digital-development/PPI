Now I have enough context. Let me write up findings.

---

# Privacy + Leakage Audit — Inventory Holds

## Scope evidence
File paths reviewed: `app/api/inventory/holds/route.ts`, `app/api/inventory/holds/bump/route.ts`, `app/api/inventory/route.ts`, `app/api/admin/holds/route.ts`, `app/api/admin/holds/[id]/route.ts`, `app/api/cron/inventory-hold-sweeper/route.ts`, `app/api/teams/inventory/route.ts`, `app/api/orders/batch/route.ts`, `lib/inventory-holds.ts`, `lib/auth-utils.ts`, `lib/audit.ts`.

---

## CRITICAL findings

### C1. `holds POST` 409 leaks `holderExpiresAt` to anyone, including foreign-team users
**File:** `app/api/inventory/holds/route.ts:110-119` + `lib/inventory-holds.ts:159-163`
The redacted branch (`canSeeHolder === false`) returns `{ error: 'item_unavailable', code: err.code }` — that part is good. **But `err.code` is `'item_already_held'`**, which differs from the chosen `'item_unavailable'`, and more importantly the helper bakes `holderExpiresAt` into `err.details` (`lib/inventory-holds.ts:162`). The route's redacted branch doesn't spread `err.details`, so the timestamp does not actually escape — verify by tracing: line 117 only returns `error` and `code`. Confirmed safe on the timestamp.

However the **code string itself leaks "this item is held by a real cart" vs `'item_unavailable'` (which can also mean "vanished mid-flight").** A foreign-team attacker probing `/api/inventory/holds POST` learns: code 409 + `code: 'item_already_held'` ⇒ a competitor's cart owns this exact `item_id`. With a public list of `item_id`s (e.g. probed by enumerating UUIDs returned to that team's own users elsewhere), this lets an outsider build a real-time "who is shopping what" oracle across tenant boundaries.
**Severity:** Medium. **Fix:** in the redacted branch, force `code: 'item_unavailable'` (drop `err.code`).

### C2. `holds POST` redacted branch still does a `prisma.user.findUnique` to decide redaction — timing oracle
**File:** `app/api/inventory/holds/route.ts:96-109`
For non-admin team_admin requesters, the route runs `prisma.inventoryHold.findFirst` then `prisma.user.findUnique` only when there's a winner. Requesters with no holder, vs cross-team holder, vs same-team holder, all take measurably different round-trip times. An attacker can time the 409 to infer whether the holder is in their own team. Low-value but real cross-tenant inference.
**Severity:** Low. **Fix:** always perform both queries (or none) regardless of branch, OR add a constant-time dummy lookup.

### C3. `/api/admin/holds` — admin-only check confirmed correct
**File:** `app/api/admin/holds/route.ts:13-15` checks `user.role !== 'admin'`. team_admin is rejected. **PASS.**

### C4. `/api/teams/inventory` PATCH same-team check — correct, but with a teamId-null edge
**File:** `app/api/teams/inventory/route.ts:131-140`
```
const sameTeam = !!hold?.owner?.teamId && !!user.teamId && hold.owner.teamId === user.teamId
if (user.role === 'admin' || sameTeam) { payload.holder = {...} }
```
Both `teamId` values are forced truthy before equality, so two `null` teamIds will NOT match. Correct. **PASS.**

But note: the holder payload returns `{ email, fullName }` — fine **within** a team, but it allows any team_admin in a team of N agents to learn the email/full name of an agent on their own team via this endpoint even if they don't already have visibility (e.g. via the holds page they don't have access to). Likely intended — flagging for awareness.

### C5. `/api/inventory` GET — `held_until_other` enforcement
**File:** `app/api/inventory/route.ts:66, 97-110`
`canSeeForeignExpiry = user.role === 'admin'` — non-admins always get `null` for `held_until_other`. Tracing `holdFlagsFor`: `held_until_other` is set only when `foreignLive && canSeeForeignExpiry`. **PASS for non-admins.**

However: **team_admins are treated as non-admin here**, so they get `null` while their own visibility filter (line 78-92) still excludes foreign-held items entirely from the result set. The only way held_until_other could surface in a team_admin's response is if they're querying their own pool — by definition not foreign. **PASS.**

### C6. **NEW BUG: `/api/inventory/holds/bump` enumeration oracle**
**File:** `app/api/inventory/holds/bump/route.ts:25` + `lib/inventory-holds.ts:235-300`
The bump handler accepts a caller-supplied `cart_item_ids` array, queries holds scoped by `ownerUserId: user.id`, and returns `byCartItem[cid] = { extended: false, reason: 'expired' }` for any id the caller passed that didn't match (`lib/inventory-holds.ts:292-296`).

This **does NOT distinguish** "the id belongs to another user's hold" from "the id was yours but expired" from "the id never existed" — all three return `{ extended: false, reason: 'expired' }`. So the response shape is uniform. **No enumeration oracle here.** **PASS.**

However: if a malicious user passes another team's `cart_item_id` they bumped from a snooped log, the response is identical to a no-op. Good. The only risk vector is if `cart_item_id` collides with one of their own (UUIDs make this negligible).

### C7. CRON_SECRET — empty-string vs unset
**File:** `app/api/cron/inventory-hold-sweeper/route.ts:5-13`
```
const secret = process.env.CRON_SECRET
if (!secret) { return 503 }
```
`!secret` is true for both `undefined` and `''`. Correct. **PASS.** No bypass via empty env var.

### C8. **NEW BUG: `holds POST` redacted error still echoes `code: 'item_already_held'`**
Same as C1 — restating because this is the highest-impact issue. The redacted branch at `app/api/inventory/holds/route.ts:116-119` propagates `err.code` ('item_already_held'). The pre-validate path in batch (line 176) correctly hard-codes `'item_unavailable'` for foreign holds — but the single-hold POST does not match that contract. Fix: replace `code: err.code` with `code: 'item_unavailable'`.

### C9. **NEW BUG: HoldConflictError details leak `holderExpiresAt` to same-team OR admin requesters via holds POST**
**File:** `app/api/inventory/holds/route.ts:111-114`
The non-redacted branch returns `...err.details`, which includes `holderExpiresAt` from `lib/inventory-holds.ts:162`. For admins this is fine. For team_admin same-team requesters, this discloses *another team member's* cart timing. Likely intended but worth confirming — if a junior agent shouldn't see when the team_admin's cart expires, this is over-sharing.
**Severity:** Low (intentional per scope rules); flagged for product review.

### C10. **NEW BUG: `batch` 409 returns `hold_id` in conflicts payload**
**File:** `app/api/orders/batch/route.ts:171, 176, 180, 341-344, 354`
Both pre-validate and tx-claim 409 responses include `hold_id` for every conflict — including the foreign-team case at line 176 where the code says "never leak which item or who" but the response still includes `hold_id: claim.holdId`. Returning the hold id back to the requester only echoes a value they already sent (they passed it in via `hold_ids`), so this is **not a leak** — the attacker would have had to know the hold id to put it in the request body. **PASS on second look**, but the comment ("never leak which item") at line 175 is inconsistent with returning `item_type` + `item_id` at line 176, which the caller also already knows. No new info disclosed.

### C11. **NEW BUG: Audit `metadata.conflicts` array stores foreign holders' `hold_id`**
**File:** `app/api/orders/batch/route.ts:184-191`
Audit row for `CartCheckoutFail` `prevalidate` includes the full `conflicts` array, which contains every hold_id the requester tried to claim — including ids that resolved to *other-team* holds (which the requester provided themselves so they already knew). The audit row is internal-admin viewable, so cross-tenant data sits in the audit log. This **is** legitimate audit data (admins should be able to investigate). **Acceptable.**

### C12. Logging PII review
**File:** `app/api/orders/batch/route.ts:207, 220, 331, 371, 397` — `console.error` / `console.log` lines. None print user emails, names, or cross-team identifiers; only Stripe customer creation failures (no email in the log) and PI ids. **PASS.**

**File:** `lib/inventory-holds.ts` — no PII in any log line (only audit-table writes, which is the correct channel). **PASS.**

---

## Summary — required fixes
1. **`app/api/inventory/holds/route.ts:117`** — change `code: err.code` to `code: 'item_unavailable'` so the 409 doesn't disclose `'item_already_held'` to foreign requesters (C1/C8).
2. **`app/api/inventory/holds/route.ts:96-109`** — make holder-visibility resolution constant-time (always run both queries or use a fixed-time path) to close the timing oracle (C2).
3. Consider whether `holderExpiresAt` should be returned to same-team team_admins; if not, strip from `err.details` before spreading (C9).

Everything else (admin/holds RBAC, inventory `held_until_other` enforcement, teams/inventory same-team check, CRON_SECRET handling, bump enumeration, PII in console logs) is correctly closed.