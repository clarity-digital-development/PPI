TSC passed clean which confirms all the fields are valid. Now produce the per-helper summary.

Per-helper email gating summary (Specialist D):

GATED HELPERS (customer-facing; recipient pref looked up via `shouldSendEmail`, fail-open on missing user / DB error / inline `recipientPrefs` shortcut):

1. `sendOrderConfirmationEmail` -> flag `emailOrderConfirmations` -> recipientUserId source: `user.id` (orders POST), `full.userId` (batch), `order.userId` (stripe webhook + admin charge).
2. `sendInstallationCompleteEmail` -> flag `emailOrderConfirmations` -> recipientUserId source: `order.userId` (orders [id] PATCH status=complete). Signature extended with optional `recipientUserId?` and `recipientPrefs?` positional args (kept first three positional args intact).
3. `sendRefundConfirmationEmail` -> flag `emailOrderConfirmations` -> recipientUserId source: `recipient.id` from `resolveRefundRecipient(order)` (refunds.ts + stripe webhook charge.refunded). `RefundRecipient` interface extended to include `id: string`; the helper now also returns the resolved user's id from all four resolution branches (placedBy / self team_admin / team_admin lookup / direct customer).
4. `sendServiceRequestConfirmationEmail` -> flag `emailServiceRequests` -> recipientUserId source: `user.id` (service-requests POST + installations/[id]/service-request POST).
5. `sendServiceRequestStatusEmail` -> flag `emailServiceRequests` -> recipientUserId source: `updated.userId` (admin SR PATCH for acknowledged / scheduled / in_progress / cancelled).
6. `sendServiceRequestCompletedEmail` -> flag `emailServiceRequests` -> recipientUserId source: `updated.userId` (admin SR PATCH for completed).

NOT GATED (intentional, per spec):

- `sendAdminOrderNotification` -> goes to `ADMIN_EMAIL` env var, no recipient User row, must always fire so ops knows an order landed.
- `sendAdminServiceRequestNotification` -> same — internal ops notification, never user-suppressed.
- `sendPasswordResetEmail` -> security-critical, must always send regardless of marketing/transactional prefs.

KEY DESIGN CHOICES:

- Gate lives inside each helper (single source of truth — a new call site can't forget to check).
- Fail-open everywhere: missing userId, missing user row, or DB error -> send anyway. Logged as "[email-prefs] lookup failed, failing open". Better to over-email than silently drop transactional mail during a Postgres hiccup.
- Optional `recipientPrefs?: UserEmailPrefs` arg on every gated helper lets a caller that already loaded the user (e.g. webhook with `include: { user: true }`) pass prefs inline and skip the extra `findUnique`. Currently no call site exercises this (deferred — every existing site has only userId in scope, not the pref columns), but the contract is there for future hot paths.
- Suppression emits a single console line `[email] EMAIL_SUPPRESSED_BY_PREFERENCE helper=... userId=... flag=...` so Railway logs show real-time opt-outs without bloating `audit_logs`.
- Helper return shape on suppression: `{ suppressed: true as const }` — distinct from a normal Resend response so callers wrapping in `Promise.all` see the no-op cleanly.
- `resolveRefundRecipient` now returns `id` in all 4 branches; this is the only public-interface widening outside `lib/email.ts`.

VERIFICATION:

- `npx tsc --noEmit` -> clean (no output, exit 0).
- All 9 customer-facing call sites threaded with `recipientUserId`. Admin + password-reset paths untouched.
- Files modified: `lib/email.ts`, `lib/email-preferences.ts` (new), `lib/orders/refund-recipient.ts`, `lib/refunds.ts`, `app/api/orders/route.ts`, `app/api/orders/batch/route.ts`, `app/api/orders/[id]/route.ts`, `app/api/admin/orders/[id]/charge/route.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/service-requests/route.ts`, `app/api/installations/[id]/service-request/route.ts`, `app/api/admin/service-requests/[id]/route.ts`.

KNOWN LIMITATIONS (carried forward from spec §6):

- Per-user only; a team_admin opting out does not silence the agents on their team. Each agent toggles their own. Team-cascade is a separate epic.
- No SMS gating (no Twilio code exists; UI shows "Coming soon").
- No CAN-SPAM unsubscribe-link path on the marketing flag — `emailMarketing` is gated, but no marketing sender helper exists yet to gate.