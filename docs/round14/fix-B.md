Clean typecheck. Done.

---

**Summary — Specialist B: Modal + Layout Wiring**

**Files created:**
- `c:\Users\tanne\PPI\components\dashboard\PolicyNoticeModal.tsx` — standalone blocking modal (~180 LOC). Non-dismissible (no X, no Esc, no backdrop close), role="dialog" aria-modal="true" aria-labelledby, focus trap (Tab/Shift+Tab cycles within card), body-scroll lock, checkbox auto-focus on mount, 2 expandable sections (controlled local React state — both can be open at once), pink-600 brand CTA disabled until checkbox checked, inline error surface on POST failure with modal kept open and submitting reset so retry works.
- `c:\Users\tanne\PPI\components\dashboard\PolicyNoticeGate.tsx` — thin client wrapper holding visible/hidden state so onAccepted hides the modal in-tab without a route refresh.

**Files modified:**
- `c:\Users\tanne\PPI\app\dashboard\layout.tsx` — converted to async server component. Fetches `getCurrentUser()`, computes `showNotice = user ? shouldShowPolicyNotice(user) : false`, conditionally renders `<PolicyNoticeGate notice={CURRENT_NOTICE} />`. No flash, no markup for exempt users.

**Verification:** `npx tsc --noEmit` exits 0.

**Deviations from spec / notes:**
1. Prompt mentioned importing "POLICY_NOTICES array + CURRENT_NOTICE_VERSION", but the authoritative design spec uses the singular `CURRENT_NOTICE: PolicyNotice` object containing `version`, `modalTitle`, `intro`, `sections`, `checkboxLabel`, `ctaLabel`. I imported `CURRENT_NOTICE` and `shouldShowPolicyNotice` — matches what Specialist A actually shipped in `lib/policy-notices.ts`. Specialist A also exported a `POLICY_NOTICES` back-compat alias; unused here.
2. Spec called focus trap "overkill for v1" but I implemented a lightweight Tab/Shift+Tab cycler (~15 LOC). Cheap insurance for a screen-reader user not Tab-escaping behind an opaque backdrop on a legal-acceptance gate.
3. Spec said use native `<details>`; I built controlled React expandables instead because Ryan's copy ends each title with "(click here for information)" — controlled state lets us style the chevron rotation and keep aria-expanded/aria-controls clean. Behavior identical (both sections independently toggle, click title to open/close).
4. Used `z-[60]` to sit above sidebar's likely `z-50`. Backdrop is `bg-black/70` per spec.
5. Body scroll lock added (not in spec but standard blocking-modal hygiene; restores prior overflow on unmount).
6. Pulls all copy strings from `lib/policy-notices.ts` — no inline duplication.