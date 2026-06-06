I have sufficient context. Note: the `/terms` page referenced in the sidebar at sign-up doesn't appear to exist in `/app/terms/` (Glob returned nothing) — likely a stale link or in `app/(marketing)/terms`. Not load-bearing for this work.

---

# Investigation Report — Policy Notice Acceptance Modal

## 1. Dashboard layout — `c:\Users\tanne\PPI\app\dashboard\layout.tsx:1-16`
**Server component** (no `'use client'`). Wraps every `/dashboard/*` page with `<Sidebar />` + `<main>`. **Does NOT fetch the user, does NOT check auth.** Auth is enforced per-page (e.g., `app/dashboard/page.tsx:1` is client-side and relies on API calls returning 401). This layout is the ideal injection point — it runs server-side on every dashboard navigation and is currently doing nothing user-aware.

## 2. Auth + user fetching — `c:\Users\tanne\PPI\lib\auth-utils.ts:5-17`
`getCurrentUser()` returns full Prisma `User` row (so any new field on `User` is automatically available). `requireAuth()` at `:19-27` throws if no user. `isAdminOrTeamAdmin()` at `:49-51` already encodes the `'team_admin'` check we'd want to invert for exemption.

The layout currently does not call these — we'd add the first call in `app/dashboard/layout.tsx`.

## 3. Modal component — `c:\Users\tanne\PPI\components\ui\Modal.tsx:1-93`
Client component. **Not blocking-friendly out of the box:**
- Backdrop click calls `onClose` (`:43`)
- Header always renders an X button (`:66-71`)
- Body renders a second X when no title (`:78-83`)

For this modal we need a non-dismissible variant. Two options: (a) extend with `dismissible?: boolean` prop (preferred, ~10 lines), or (b) build a one-off `PolicyNoticeModal` that doesn't use the shared component. Recommend (a) — it's a one-prop addition that benefits future required modals.

No existing auto-pop-on-login modal in dashboard pages (grep for "terms/accept/policy/notice" in `app/dashboard/**` only hit profile/orders/options pages for unrelated reasons).

## 4. Existing terms/notice infrastructure
- Sign-up page links to `/terms` (`app/(auth)/sign-up/page.tsx:195`) but no `app/terms/` directory exists (Glob empty) — stale link, not relevant here.
- No existing acceptance UI to extend. Greenfield.

## 5. Schema — `c:\Users\tanne\PPI\prisma\schema.prisma:69-133` (User model)
**No existing `policyAcceptedAt` / `termsAcceptedAt` field.** Confirmed.

**Recommendation — add two fields + an enum for the version:**
```
policyNoticeAcceptedAt      DateTime? @map("policy_notice_accepted_at")
policyNoticeAcceptedVersion String?   @map("policy_notice_accepted_version")
```
String version (not int) so we can use semantic tags like `"2026-06-out-of-area-v1"`. When Ryan adds a future notice we bump the constant in code; if user's stored version != current, the modal pops again. Don't reuse a single boolean — that's a one-shot we can never re-trigger.

## 6. Exemption gate
Confirmed pattern at `lib/service-area.ts:134`:
```ts
if (input.user && (input.user.role === 'team_admin' || input.user.isServiceAreaExempt)) { ... }
```
**Recommend the modal use the IDENTICAL gate.** Rationale: Ryan said "will not apply to Semonin accounts" — Semonin is a team_admin per round-10. `isServiceAreaExempt` also covers any admin-flagged relationship customers Ryan may exempt later. Also exempt `role === 'admin'` (Pink Posts internal staff shouldn't see customer notices). Encapsulate as `shouldShowPolicyNotice(user, currentVersion)` in a new `lib/policy-notice.ts`.

## 7. Render strategy — server-side conditional, strongly recommend
Compute `shouldShow` in `app/dashboard/layout.tsx` (now becomes async server component, calls `getCurrentUser()`), and only render `<PolicyNoticeModal />` if true. Benefits:
- No flash of modal for exempt/already-accepted users
- No client-side fetch race
- No modal markup in HTML for exempt users (cleaner inspect-element story)
- Layout already re-runs on dashboard navigation so acceptance state stays fresh

Acceptance API: `POST /api/me/policy-notice/accept` → updates the two fields + writes `audit({ action: 'policy_notice.accepted', metadata: { version } })`. On success, client closes modal and `router.refresh()` to re-run the server layout.

## Out-of-scope flag for Tanner→Ryan
The modal informs about post-rental billing ($18 at 6mo/9mo, $6/mo after 12mo) but **no billing automation exists yet**. Confirm with Ryan: should we ship the modal now (informational) and follow up with the cron/billing work, or block this on the billing implementation? Recommend ship modal now — acceptance creates legal cover for when billing lands.

## Files this feature will touch
- `prisma/schema.prisma` (2 fields on User)
- `app/dashboard/layout.tsx` (convert to async server component, gate render)
- `components/ui/Modal.tsx` (add `dismissible?: boolean`)
- `components/dashboard/policy-notice-modal.tsx` (new)
- `lib/policy-notice.ts` (new — version constant + `shouldShowPolicyNotice` helper)
- `app/api/me/policy-notice/accept/route.ts` (new POST endpoint)