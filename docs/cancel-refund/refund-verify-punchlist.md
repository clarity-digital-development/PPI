# Refund Flow Audit — Prioritized Punch List

## P0 — Block merge

**R1. Concurrent refundOrder writes lose attribution + duplicate emails**
Source: Race/F3, Race/F7, Payment/F2, Payment/F8
File: `lib/refunds.ts:112-123`
Two simultaneous calls (customer double-click, or customer+admin race) both pass the `refundId===null` read, both write — last writer clobbers `cancelReason`/`cancelledByUserId`/`refundReason`, two audit rows written, two customer emails sent.
Fix: Conditional update `where: { id, refundId: null }`; on P2025 return `ALREADY_REFUNDED` and skip email.

**R2. Webhook races mid-flight refundOrder → misclassified as `stripe_dashboard` + duplicate email**
Source: Race/F2, Race/F4, Payment/F2
File: `app/api/webhooks/stripe/route.ts:184,209,246-263` + `lib/refunds.ts:154-173`
Stripe webhook arrives between `refunds.create()` and the line-112 DB update; webhook sees `refundId===null`, stamps `cancelReason='stripe_dashboard'`, sends "admin" email; refundOrder then overwrites attribution and sends a second customer email.
Fix: Reserve `refundEmailSentAt = new Date()` before email send (conditional `where: { refundEmailSentAt: null }`), and gate webhook "dashboard-initiated" branch on `refundInitiatedAt === null` not just `refundId === null`.

## P1 — Must land in this PR

**R3. Stripe idempotency key collision returns false STRIPE_ERROR during race**
Source: Race/F8
File: `lib/refunds.ts:86-97` + `lib/stripe/server.ts:168-187`
Customer/admin race sends same idempotency key with different `cancel_reason`/`actor_user_id` metadata → Stripe rejects second call with 400, refundOrder returns STRIPE_ERROR and writes `OrderRefundFail` audit despite the refund having succeeded.
Fix: Remove per-actor fields (`cancel_reason`, `actor_user_id`) from Stripe metadata (keep in our audit only), or catch the idempotency error and treat as success after refetching the Refund.

**R4. Partial dashboard refund leaves order in `succeeded` and corrupts later full-refund email**
Source: Payment/F1
File: `app/api/webhooks/stripe/route.ts:189-205`
On `!isFullRefund`, code audits and breaks without persisting `refundedAmount`; a later full-refund event then computes email amount from `charge.amount_refunded` and emails the customer the *cumulative* total, overstating the final refund by the prior partial.
Fix: Always persist `refundedAmount = refundedCents/100` (plus a `partialRefundedAt`); when the eventual full-refund event fires, compute email amount as the delta or suppress email when prior partials exist.

**R5. DB-blip after Stripe success → phantom refund + wrong webhook classification**
Source: Race/F1
File: `lib/refunds.ts:87-123`
If the line-112 update throws after Stripe succeeds, `refundId` is never persisted; the inbound `charge.refunded` webhook then enters the dashboard-initiated branch with wrong audit/email.
Fix: Wrap the post-Stripe DB write in a small retry loop AND have webhook check `refundInitiatedAt` (per R2) so the race-window misclassification is impossible.

## P2 — Follow-up

**R6. Webhook event-ID dedup table**
Source: Race/F5 — replays during race windows re-execute non-idempotent branches; add a `processed_stripe_events(event_id)` table keyed on `event.id`.

**R7. 24h cutoff uses UTC midnight, not `scheduledDate - 24h`**
Source: Race/F6, Payment/F4
File: `app/api/orders/[id]/cancel/route.ts:72-88`
PT-zone installs lose up to 13h of their advertised 24h window; ET-zone edge cases shift the cutoff a day. Fix: `cutoff = scheduledDate - 24h` directly, or document the policy.

**R8. `placedByUserId` recipient + GET visibility survive role/team demotion**
Source: Privacy/F1, Privacy/F3
File: `lib/orders/refund-recipient.ts:39-51` + `app/api/orders/[id]/route.ts:23-29`
Demoted team_admin still receives refund emails and can GET full PII indefinitely. Fix: Re-assert `placer.role==='team_admin' && placer.teamId===order.user.teamId` at both query and recipient resolution.

**R9. Orphan-agent fallback emails the agent against locked policy**
Source: Privacy/F2
File: `lib/orders/refund-recipient.ts:78-83`
When a team has no current admin, agent receives the email directly. Fix: Skip email + write `OrderRefundFail{stage:'recipient'}` audit.

## P3 — Nice-to-have

**R10.** Strip free-text `customerReason` from broker-bound emails (Privacy/F6 sub-note).
**R11.** Collapse 404/403 in cancel route to single 404 (Privacy/F4).
**R12.** Pin `restoreIfSafe` safety with a regression test (Payment/F3).
**R13.** CC the agent when team_admin cancels on their behalf (Privacy/F7 product call).

---

## CONCLUSION

- **P0: 2** (R1, R2)
- **P1: 3** (R3, R4, R5)

**Recommendation: BLOCK.** R1 and R2 produce user-visible duplicate emails AND corrupt audit attribution on every race that exceeds ~500ms — common given Stripe webhook latency. Neither is a "rare edge"; double-clicking Cancel triggers R1 deterministically.

**To ship, this PR must additionally land:** R3 (false-error during race), R4 (wrong-amount customer email on partial-then-full), R5 (retry + webhook gate that closes the phantom-refund window opened by R1/R2 fixes). R6–R13 can be follow-ups.