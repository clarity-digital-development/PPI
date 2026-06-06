Zero errors in my files. All deliverables complete.

---

**Files delivered (absolute paths):**

1. `c:\Users\tanne\PPI\app\api\admin\orders\[id]\route.ts`
   GET handler extended to include `installation`, `postRentalCharges`, and `user.role`/`user.isServiceAreaExempt`; returns a computed `postRental` block alongside `order`.

2. `c:\Users\tanne\PPI\lib\post-rental\admin-view.ts`
   Pure `computePostRentalView()` aggregator returning `{ status, reason, installedAt, stoppedAt, override, nextCharge, history }`; mirrors the eligibility ladder (exempt > no installation > stopped > not-completed > grandfathered > active) and computes next-charge preview by walking 6mo/9mo/monthly anchors and skipping ones already scheduled.

3. `c:\Users\tanne\PPI\app\api\admin\orders\[id]\post-rental\retry\route.ts`
   POST { chargeId } admin endpoint. Validates the charge belongs to the order and is `failed`, conditionally flips it back to `scheduled` (clears `failureCode`/`failureMessage`/`attemptedAt`), audits `PostRentalChargeRetry`. The next cron pass picks it up — no inline Stripe call.

4. `c:\Users\tanne\PPI\app\api\admin\orders\[id]\post-rental\override\route.ts`
   POST { enabled, reason? } admin endpoint. Flips `Order.postRentalEnabledOverride`, no-op fast-path when unchanged (skips audit spam), audits `PostRentalOverrideToggle` with before/after on real changes.

5. `c:\Users\tanne\PPI\app\admin\orders\[id]\page.tsx`
   Added `PostRentalView` interface, state (`postRental`, `retryingChargeId`, `overrideSaving`, banner/error), `handleRetryCharge()` and `handleToggleOverride()`, mounted `<PostRentalCard>` after Order Items, and defined the `PostRentalCard` component below the page export. Card renders: status badge, clock-started/stopped/reason block, next-charge preview (active only), opt-in toggle (grandfathered or override-on), and chronological history table with retry button on failed rows + Stripe dashboard links.

`npx tsc --noEmit` clean for all five files (only pre-existing unrelated error in untracked `scripts/_explore-rental-base.ts`).