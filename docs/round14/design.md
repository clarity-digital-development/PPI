# Policy Notice Acceptance Modal — Implementation Spec

## 1. Schema changes — `prisma/schema.prisma` (User model)

Add two fields to the `User` model:

```prisma
policyNoticeAcceptedAt  DateTime? @map("policy_notice_accepted_at")
policyNoticeVersion     Int       @default(0) @map("policy_notice_version")
```

Defaults: `policyNoticeAcceptedAt = NULL`, `policyNoticeVersion = 0`. Every existing user has version 0, and `CURRENT_NOTICE_VERSION = 1`, so everyone sees the modal exactly once on next dashboard load. Migration name: `add_policy_notice_acceptance`.

---

## 2. Constants — `lib/policy-notices.ts` (NEW)

```ts
export const CURRENT_NOTICE_VERSION = 1;

export interface PolicyNoticeSection {
  id: string;
  title: string;
  body: string;
}

export interface PolicyNotice {
  version: number;
  modalTitle: string;
  intro: string;
  sections: PolicyNoticeSection[];
  checkboxLabel: string;
  ctaLabel: string;
}

export const CURRENT_NOTICE: PolicyNotice = {
  version: CURRENT_NOTICE_VERSION,
  modalTitle: "Notice to Realtors:",
  intro: "Pink Posts strives to keep pricing as cheap as possible...", // verbatim from Ryan
  sections: [
    {
      id: "out-of-area-fee",
      title: "New: Out of Area Fee (click here for information)",
      body: "Starting today, all future orders that our in rural areas...", // verbatim
    },
    {
      id: "post-rental-fee",
      title: "Clarification: Post Rental Fee after 6 months (click here for information)",
      body: "This rental structure was in the initial terms and conditions...", // verbatim
    },
  ],
  checkboxLabel: "I have read and understand these adjustments",
  ctaLabel: "Continue to my dashboard",
};

// WHY: shared exemption rule mirrors lib/service-area.ts and round-10 directive
export function isPolicyNoticeExempt(user: {
  role: string;
  isServiceAreaExempt?: boolean | null;
}): boolean {
  return user.role === "team_admin" || user.role === "admin" || !!user.isServiceAreaExempt;
}

export function shouldShowPolicyNotice(user: {
  role: string;
  isServiceAreaExempt?: boolean | null;
  policyNoticeVersion: number;
}): boolean {
  if (isPolicyNoticeExempt(user)) return false;
  return user.policyNoticeVersion < CURRENT_NOTICE_VERSION;
}
```

Copy strings stored verbatim from Ryan's text.

---

## 3. API endpoint — `app/api/profile/accept-notice/route.ts` (NEW)

```ts
// POST /api/profile/accept-notice
// Body: { version: number }
// Returns: 200 { ok: true } | 400 | 401
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1 || version > CURRENT_NOTICE_VERSION) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      policyNoticeAcceptedAt: new Date(),
      policyNoticeVersion: version,
    },
  });

  await audit({
    actorUserId: user.id,
    action: "policy_notice.accepted",
    entityType: "User",
    entityId: user.id,
    metadata: { version },
    request: req, // captures IP + UA via audit helper convention
  });

  return NextResponse.json({ ok: true });
}
```

Validation rejects future versions (prevents client claiming v999). Audit row is the legal trail.

---

## 4. Modal component — `components/dashboard/PolicyNoticeModal.tsx` (NEW)

Client component. Props:

```ts
interface Props {
  notice: PolicyNotice;     // full notice object from constants
  onAccepted: () => void;   // parent hides modal on success
}
```

Structure:
- Fixed full-screen backdrop (`bg-black/70`, opaque enough to block interaction)
- Centered card (`max-w-2xl`, scrollable body if overflow)
- **No X button, no Esc handler, no backdrop-click close** — non-dismissible
- Title `notice.modalTitle` (h2, brand pink)
- Intro paragraph `notice.intro`
- For each section: collapsible `<details>` (native, no extra deps) with summary = `section.title`, body = `section.body` rendered as paragraph
- Required checkbox + label `notice.checkboxLabel` — controls local `accepted: boolean` state
- Primary button `notice.ctaLabel`:
  - `disabled={!accepted || submitting}`
  - onClick: POST to `/api/profile/accept-notice` with `{ version: notice.version }`
  - On 200: call `onAccepted()` (parent hides modal)
  - On error: inline error message, button re-enables

Do NOT extend the shared `components/ui/Modal.tsx` — that one is dismissible by design. Build this standalone (~120 LOC) to keep blocking behavior obvious and isolated.

A11y: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title. Focus trap is overkill for v1; auto-focus the checkbox on mount.

---

## 5. Gating wiring — `app/dashboard/layout.tsx`

Convert to async server component:

```tsx
import { getCurrentUser } from "@/lib/auth-utils";
import { CURRENT_NOTICE, shouldShowPolicyNotice } from "@/lib/policy-notices";
import PolicyNoticeGate from "@/components/dashboard/PolicyNoticeGate";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const showNotice = user ? shouldShowPolicyNotice(user) : false;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1">{children}</main>
      {showNotice && <PolicyNoticeGate notice={CURRENT_NOTICE} />}
    </div>
  );
}
```

`PolicyNoticeGate` is a tiny client wrapper:

```tsx
"use client";
export default function PolicyNoticeGate({ notice }: { notice: PolicyNotice }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return <PolicyNoticeModal notice={notice} onAccepted={() => setVisible(false)} />;
}
```

Why split: server layout decides whether to show (no flash, no exempt-user markup); client wrapper holds the "user just accepted, hide it now without a full refresh" state. Next nav re-runs server layout, sees the DB timestamp, doesn't render the gate.

---

## 6. Exemption confirmed

`isPolicyNoticeExempt` returns true for:
- `role === 'team_admin'` (Semonin and all broker accounts per round-10)
- `role === 'admin'` (Pink Posts internal staff — defense in depth even though admins live at /admin/*)
- `isServiceAreaExempt === true` (per-user admin-flagged exemption)

Identical pattern to `lib/service-area.ts:134` — single source of truth would be even better but not worth the refactor in this round.

---

## 7. Audit + privacy

Audit row written on each acceptance:
- `actorUserId` = user.id
- `action` = `"policy_notice.accepted"`
- `entityType` = `"User"`, `entityId` = user.id
- `metadata` = `{ version: 1 }`
- IP + UA captured via the standard `audit()` helper's request extraction

This is the durable legal record. `audit()` never throws — if it fails, the acceptance still persists.

---

## 8. Edge cases handled

- **Multi-tab**: other tabs keep showing the modal until next nav (acceptable v1; the API is idempotent — re-accepting just bumps the timestamp).
- **Session clear**: acceptance lives on User row, not session — survives logout/login.
- **Version bumps**: change `CURRENT_NOTICE_VERSION = 2` and update `CURRENT_NOTICE` copy. Everyone with `policyNoticeVersion < 2` re-sees the modal automatically.
- **Race**: if two requests land simultaneously the last write wins; both audit rows persist. Fine.

---

## 9. OUT OF SCOPE — flag for Tanner → Ryan

The modal **informs** customers about post-rental billing ($18 at 6mo, $18 at 9mo, $6/mo after 12mo). **No billing automation exists for this.** Required follow-up project:
- Cron/scheduled job walking `Order` rows with `status = active`
- Compute anniversary dates from install date
- Fire Stripe charges at 6mo / 9mo / monthly post-12mo
- Idempotency (don't double-charge), failure handling, customer notification

Recommend shipping the modal **now** — acceptance creates the legal cover for billing when it lands. Tanner should raise the billing-automation scoping conversation with Ryan as the immediate next step.

---

## 10. Effort estimate (target ≤ 3h)

| Piece | Est |
|---|---|
| Prisma schema + migration | 15 min |
| `lib/policy-notices.ts` (constants + helpers) | 20 min |
| `POST /api/profile/accept-notice` route | 25 min |
| `PolicyNoticeModal.tsx` (blocking modal, copy, checkbox, CTA) | 60 min |
| `PolicyNoticeGate.tsx` + `dashboard/layout.tsx` wiring | 20 min |
| Manual QA (exempt team_admin, fresh user, accept→reload, version bump) | 30 min |
| `npx tsc --noEmit` + audit verification | 10 min |
| **Total** | **~3h** |

Specialist split:
- **Schema/API specialist**: items 1, 2, 3 (~1h)
- **Modal/wiring specialist**: items 4, 5 (~1h20), plus QA

Both reference `lib/policy-notices.ts` as the contract.