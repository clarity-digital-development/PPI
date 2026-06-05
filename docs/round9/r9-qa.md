### Per-piece verdict

| Piece | Status | Notes |
|---|---|---|
| Schema | PASS | 4 new `User` columns + `UserPreferenceChange` model + reverse relation match spec. Defaults (`true/true/false`) preserve existing send-everything behavior. Live Railway row `meganmoore0517@gmail.com` returns the new columns at their defaults; `user_preference_changes` table queryable (0 rows). |
| API | PASS | `GET /api/profile` now selects the 3 flags + `notificationPrefsUpdatedAt`. New `PATCH` handler: Zod-validates partial body, rejects empty body via `.refine`, no-op short-circuit returns `{ok:true,noop:true,prefs}`, persists with `notificationPrefsUpdatedAt = now()`, writes fire-and-forget `UserPreferenceChange` row with diff JSON + IP + UA (catches errors). Invalid-JSON path returns 400. PUT path for `fullName/phone/company` untouched. |
| UI | PASS | Hardcoded `defaultChecked` array replaced with controlled checkboxes hydrated from `/api/profile`. Save-on-toggle via `PATCH` with optimistic update + rollback on failure + per-row `savingPref` guard against double-clicks. Inline auto-dismissing success/error banner (no toast lib in repo). SMS row disabled with "Coming soon" badge as spec'd. Helper `PrefRow` component keeps markup DRY. |
| Email gates | PASS | `lib/email-preferences.ts` exports `shouldSendEmail(userId, flag, userPrefs?)` with fail-open semantics (unknown user, missing row, DB error → return true). All 6 customer-facing helpers gated: `sendOrderConfirmationEmail`, `sendInstallationCompleteEmail`, `sendRefundConfirmationEmail`, `sendServiceRequestConfirmationEmail`, `sendServiceRequestStatusEmail`, `sendServiceRequestCompletedEmail`. Suppression returns `{suppressed: true as const}` + emits `EMAIL_SUPPRESSED_BY_PREFERENCE` log. Admin notifications and password-reset confirmed un-gated. `resolveRefundRecipient` widened to return `id` in all 4 branches; both call sites (`lib/refunds.ts`, stripe webhook `charge.refunded`) thread `recipient.id`. All 9 customer-facing call sites pass `recipientUserId` (confirmed via grep). |

### Gate verification (behavioral)
- **Prefs flag:** `emailOrderConfirmations` via `sendOrderConfirmationEmail`
- **Pref=false result:** `[email] EMAIL_SUPPRESSED_BY_PREFERENCE helper=sendOrderConfirmationEmail userId=cmq1hblp90000zwmfimcxyqu1 flag=emailOrderConfirmations` → helper returned `{"suppressed":true}` (no Resend call)
- **Pref=true result:** Resend send id `5473ddaa-4c7d-47c1-8f37-299ef9607ac7` (real email delivered to `tannercarlson@vvsvault.com`)
- Live Railway DB confirmed columns + audit table; gate check `shouldSendEmail` returns `false` for OFF and `true` for ON; user-row toggles via Prisma succeeded both ways; prefs restored on cleanup.

### Typecheck
`npx tsc --noEmit` — clean (exit 0, zero errors).

### Recommendation
**Ship.** All four specialists delivered to spec, types compile clean across the repo, schema is additive (no existing user loses email), the gate fires correctly in both directions against the live DB + live Resend, audit trail in place, admin/password-reset paths untouched. Deferred items (SMS persistence, team-cascade, marketing sender, admin override UI, CAN-SPAM token) are documented in spec §6 and appropriately out of scope.

Files modified: `prisma/schema.prisma`, `app/api/profile/route.ts`, `app/dashboard/profile/page.tsx`, `lib/email.ts`, `lib/orders/refund-recipient.ts`, `lib/refunds.ts`, `app/api/orders/route.ts`, `app/api/orders/batch/route.ts`, `app/api/orders/[id]/route.ts`, `app/api/admin/orders/[id]/charge/route.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/service-requests/route.ts`, `app/api/installations/[id]/service-request/route.ts`, `app/api/admin/service-requests/[id]/route.ts`. New file: `lib/email-preferences.ts`.