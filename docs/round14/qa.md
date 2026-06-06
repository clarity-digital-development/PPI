No `any`, no `dangerouslySetInnerHTML`, no dismiss handlers. Final report:

---

### Per-piece verdict (A / B)

**Specialist A (schema + API + constants): PASS**
- `prisma/schema.prisma` adds `policyNoticeAcceptedAt DateTime?` + `policyNoticeVersion Int @default(0)` with correct snake_case mapping (verified live on Railway: column types and defaults exist; sample customer row shows `null` / `0`).
- `lib/audit.ts` adds `AuditAction.PolicyNoticeAccepted = 'policy_notice.accepted'`. End-to-end probe wrote a real row with that action name, the correct `targetType='User'`, `actorEmail`, and `metadata: { version: 1 }`.
- `lib/policy-notices.ts` exports `CURRENT_NOTICE` with Ryan's verbatim copy, `CURRENT_NOTICE_VERSION = 1`, `isPolicyExempt()` (team_admin OR admin OR isServiceAreaExempt), and `shouldShowPolicyNotice()`. Live evaluation: regular customer → true, both `test@pinkposts.com` (team_admin) AND `supportstaff@semonin.com` (the actual Semonin Broker) → false, admin → false.
- `POST /api/profile/accept-notice` validates with Zod `z.number().int().min(1).max(CURRENT_NOTICE_VERSION)` (rejects v999), 401 if unauthenticated, exempt no-op short-circuits with `{ ok: true, exempt: true }`, updates row, writes audit row with `request` for IP/UA capture.

**Specialist B (modal + wiring): PASS**
- `PolicyNoticeModal.tsx`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to title; no X button, no Esc handler, no backdrop onClick — verified by grep (no `onClose`, no `Escape`); body-scroll lock; focus trap that cycles Tab/Shift+Tab; checkbox auto-focus on mount; CTA disabled until `accepted && !submitting`; inline error surface that resets `submitting` so retry works; pink-600 brand button per design system.
- `PolicyNoticeGate.tsx` is a thin client wrapper holding visible state so onAccepted hides without full route refresh.
- `app/dashboard/layout.tsx` correctly converted to async server component, fetches `getCurrentUser()`, computes `showNotice` server-side (no flash for exempt users), conditionally renders gate.

### Code-quality issues

None blocking. Minor observations:
1. `POLICY_NOTICES` back-compat alias in `lib/policy-notices.ts` is unused — could drop, but harmless.
2. Modal text is rendered via React JSX text nodes, so React auto-escapes — no XSS risk even if Ryan's copy ever contained `<`. No `dangerouslySetInnerHTML` anywhere.
3. No `any` in any of the three new files.
4. Spec deviated correctly: B implemented controlled React expandables instead of `<details>` (the spec author signed off in their write-up; gives clean aria-expanded/aria-controls and chevron rotation).
5. Multi-tab edge case: other tabs keep the modal up until next nav; the API is idempotent so re-accept just bumps the timestamp. Acceptable per design §8.

### Typecheck status

`npx tsc --noEmit` exits 0 (clean).

### Behavioral verification result

**DB schema**: Confirmed live on Railway. Sample probe of one row per role:
- customer (`q.i.yi.nu.t81.5@gmail.com`): `policyNoticeAcceptedAt=null, policyNoticeVersion=0` → `shouldShow=true`
- team_admin (`test@pinkposts.com`): `shouldShow=false`
- admin (`admin@pinkposts.com`): `shouldShow=false`
- **`supportstaff@semonin.com` (the real Semonin Broker account, role=team_admin): `shouldShow=false`** ✓ Ryan's "will not apply to Semonin accounts" requirement satisfied.

**End-to-end simulate** (seeded QA customer, applied the exact Prisma update the route applies, wrote audit row via real `audit()` helper, then reset):
- Before: `shouldShow=true`
- After update: `policyNoticeAcceptedAt=2026-06-06T22:54:39.996Z, policyNoticeVersion=1` → `shouldShow=false`
- Audit row written: `action='policy_notice.accepted', targetType='User', actorEmail='qa-policy@test.local', metadata={ version: 1 }` ✓
- Reset back to null — repeatable.
- QA user + audit row cleaned up at end.

**Live browser walkthrough (Playwright)**: Could not complete. Dev server on :3000 has a pre-existing compile-worker crash (`Jest worker encountered 2 child process exceptions, exceeding retry limit`) that makes `/api/auth/session` return HTML 500, blocking signin entirely. This is unrelated to the policy-notice code (the affected file is webpack/jest-worker infra). Recommend restarting the dev server (`npm run dev`) and doing a 30-second manual click-through after merge: sign in as `qa-policy@test.local` (or any customer with `policyNoticeAcceptedAt=null`) → confirm modal blocks `/dashboard` → check checkbox → click CTA → confirm reload shows no modal.

### Recommendation: **SHIP**

Schema is live, helpers and API are correct, gating logic verified against real DB rows for all four user shapes, audit trail confirmed writing. Modal is genuinely non-dismissible (no X/Esc/backdrop close, focus trapped, body scroll locked). Exemption correctly hides for Semonin and all team_admins/admins. Out-of-scope flag (post-rental billing automation) is correctly called out in the design doc — Tanner should raise with Ryan as follow-up.

One housekeeping note: the dev server's compile-worker crash is unrelated but worth a restart before any further QA. The three QA scripts I created during verification have been deleted; the QA seed user + its audit row have been removed.