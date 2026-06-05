# Notification Preferences — Implementation Spec

**Goal:** Make the 4 decorative checkboxes on `/dashboard/profile` actually work, so Peggy's team at Semonin can reduce email volume. Three real flags + one "Coming Soon" SMS placeholder. ~3.5h, four parallel specialists.

---

## 1. Schema changes (Specialist A — Prisma)

**File:** `prisma/schema.prisma` — append to `User` model.

```prisma
model User {
  // ...existing fields above...

  // Notification preferences — defaults preserve current behavior (everything on except marketing)
  emailOrderConfirmations Boolean @default(true)  @map("email_order_confirmations")
  emailServiceRequests    Boolean @default(true)  @map("email_service_requests")
  emailMarketing          Boolean @default(false) @map("email_marketing")
  notificationPrefsUpdatedAt DateTime? @map("notification_prefs_updated_at")
}
```

Then add a new audit model (separate from existing `UserRoleChange` — keeps schema search clean):

```prisma
model UserPreferenceChange {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  changedBy   String   @map("changed_by") // userId of actor (usually == userId; admin override possible)
  changes     Json     // { emailOrderConfirmations: { from: true, to: false }, ... }
  ipAddress   String?  @map("ip_address")
  userAgent   String?  @map("user_agent")
  createdAt   DateTime @default(now()) @map("created_at")

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("user_preference_changes")
}
```

Add reverse relation on `User`:
```prisma
preferenceChanges UserPreferenceChange[]
```

**Migration:** `npx prisma db push` — additive only, all defaults match current send-everything behavior, **no existing user suddenly loses email**. No data migration needed.

**Why no SMS column:** Auditor C confirmed zero Twilio code exists. Don't persist a flag for a feature that can't fire. UI will show a disabled "Coming soon" row instead.

---

## 2. API endpoint (Specialist B — backend)

**Extend** `app/api/profile/route.ts` rather than adding a new route — already auth-gated, already returns/accepts user fields, less surface area.

### GET — extend the select
```ts
// route.ts:22-30 area — add to select
emailOrderConfirmations: true,
emailServiceRequests: true,
emailMarketing: true,
notificationPrefsUpdatedAt: true,
```
Return them at the top level of the `profile` object (same shape both keys).

### PATCH (new) — preferences-only
Add a new `PATCH` handler in the same file. Separate from PUT so the existing profile-edit save path stays untouched and a regression in one can't break the other.

```ts
const PrefsSchema = z.object({
  emailOrderConfirmations: z.boolean().optional(),
  emailServiceRequests:    z.boolean().optional(),
  emailMarketing:          z.boolean().optional(),
}).refine(o => Object.keys(o).length > 0, 'No fields provided');

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = PrefsSchema.parse(await req.json());

  // Load current values so we can diff for the audit row
  const current = await prisma.user.findUnique({
    where: { id: user.id },
    select: { emailOrderConfirmations: true, emailServiceRequests: true, emailMarketing: true },
  });
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const changes: Record<string, { from: boolean; to: boolean }> = {};
  for (const k of Object.keys(body) as (keyof typeof body)[]) {
    if (body[k] !== undefined && body[k] !== current[k]) {
      changes[k] = { from: current[k], to: body[k]! };
    }
  }
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { ...body, notificationPrefsUpdatedAt: new Date() },
    select: { emailOrderConfirmations: true, emailServiceRequests: true, emailMarketing: true, notificationPrefsUpdatedAt: true },
  });

  // Fire-and-forget audit (never throws — same pattern as lib/audit)
  await prisma.userPreferenceChange.create({
    data: {
      userId: user.id,
      changedBy: user.id,
      changes,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent') ?? null,
    },
  }).catch(err => console.error('[prefs] audit failed', err));

  return NextResponse.json({ ok: true, prefs: updated });
}
```

**Why PATCH not PUT:** PUT semantically replaces. PATCH lets the UI send a single field per toggle (save-on-toggle pattern). Smaller payload, cleaner diff.

**No admin override path yet** — defer until support actually asks for it.

---

## 3. UI rewrite (Specialist C — frontend)

**File:** `app/dashboard/profile/page.tsx` lines 181-221.

### State
Hydrate from GET response (already returns prefs after Specialist B's change):
```ts
const [prefs, setPrefs] = useState({
  emailOrderConfirmations: true,
  emailServiceRequests: true,
  emailMarketing: false,
});
const [savingPref, setSavingPref] = useState<string | null>(null);
```

In the existing `fetch('/api/profile')` effect, set prefs from the response.

### Toggle handler (save-on-toggle + optimistic + rollback)
```ts
async function togglePref(key: keyof typeof prefs, next: boolean) {
  const prev = prefs[key];
  setPrefs(p => ({ ...p, [key]: next }));  // optimistic
  setSavingPref(key);
  try {
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next }),
    });
    if (!res.ok) throw new Error('save failed');
    toast.success('Preference saved');
  } catch {
    setPrefs(p => ({ ...p, [key]: prev }));  // rollback
    toast.error('Could not save — please try again');
  } finally {
    setSavingPref(null);
  }
}
```

### Render — 4 rows
1. **Email notifications for new orders** → `emailOrderConfirmations`. Helper text: "Order confirmations, refund receipts, installation-complete emails."
2. **SMS notifications for installation updates** → disabled, with right-side "Coming soon" badge. No handler. (Auditor C confirmed zero SMS code; do not persist a dead flag.)
3. **Email notifications for service requests** → `emailServiceRequests`. Helper text: "Confirmations, status updates, and completion notices."
4. **Marketing emails and promotions** → `emailMarketing`. Helper text: "Occasional product news and promos. Off by default."

Each enabled row: `<input type="checkbox" checked={prefs.x} onChange={e => togglePref('x', e.target.checked)} disabled={savingPref==='x'}>`. Show a small `Loader2` spinner next to the row label when `savingPref===key`.

**No "Save Preferences" button.** Save-on-toggle is the modern pattern and means a user who toggles off in a rage and closes the tab still wins.

---

## 4. Email-send gating (Specialist D — lib/email)

**Approach (a) — gate inside the helper.** Single source of truth, can't be forgotten at a new call site.

### New helper: `lib/email-preferences.ts`
```ts
import { prisma } from '@/lib/prisma';

type Flag = 'emailOrderConfirmations' | 'emailServiceRequests' | 'emailMarketing';

export async function shouldSendEmail(userId: string | null | undefined, flag: Flag): Promise<boolean> {
  if (!userId) return true;  // unknown recipient — fail-open (don't silently drop)
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { [flag]: true } as any });
    if (!u) return true;
    return Boolean((u as any)[flag]);
  } catch (err) {
    console.error('[email-prefs] lookup failed, failing open', err);
    return true;  // DB hiccup must NOT block transactional email
  }
}
```

### Wire into each helper
Each customer-facing helper takes an optional `recipientUserId` arg (or uses the existing `order.user.id` / `userInfo.id` already in scope) and short-circuits:

```ts
export async function sendOrderConfirmationEmail(order, recipientUserId: string) {
  if (!(await shouldSendEmail(recipientUserId, 'emailOrderConfirmations'))) {
    console.log(`[email] suppressed sendOrderConfirmationEmail for user=${recipientUserId} (pref off)`);
    return { suppressed: true };
  }
  // ...existing send code
}
```

### Flag mapping (from Auditor C's table)
| Helper | Flag | Recipient userId source |
|---|---|---|
| `sendOrderConfirmationEmail` | `emailOrderConfirmations` | `order.userId` |
| `sendInstallationCompleteEmail` | `emailOrderConfirmations` | `order.userId` |
| `sendRefundConfirmationEmail` | `emailOrderConfirmations` | `resolveRefundRecipient(order).id` — **extend helper to return id** |
| `sendServiceRequestConfirmationEmail` | `emailServiceRequests` | `userInfo.id` |
| `sendServiceRequestStatusEmail` | `emailServiceRequests` | `serviceRequest.userId` |
| `sendServiceRequestCompletedEmail` | `emailServiceRequests` | `serviceRequest.userId` |
| (future marketing blast) | `emailMarketing` | per-recipient |
| `sendAdminOrderNotification` | **NO GATING** | env `ADMIN_EMAIL` |
| `sendAdminServiceRequestNotification` | **NO GATING** | env `ADMIN_EMAIL` |
| `sendPasswordResetEmail` | **NO GATING** | security-critical |

**Known limitation to document in changelog** (per Auditor C): team-agent inboxes are flooded by order confirms; this MVP gates per-user, so a broker toggling off doesn't silence their agents. Each agent toggles their own. Punt cascade-from-team to a later round.

---

## 5. Audit log

Already covered by `UserPreferenceChange` in §1 + the `prisma.userPreferenceChange.create` call in §2. Diff stored as `{ field: { from, to } }` JSON. Indexed on `(userId, createdAt)` so support can answer "when did Peggy opt out" in one query.

Also add a lightweight `EMAIL_SUPPRESSED_BY_PREFERENCE` log line (console only, not DB) inside `shouldSendEmail`'s false branch so Railway logs show suppression in real time without bloating `AuditLog`.

---

## 6. What we are NOT building (defer list)

- **SMS preferences** — no Twilio integration exists. UI shows "Coming soon" badge; no column persisted.
- **Per-event-type toggles** (separate "scheduled" vs "in_progress" SR sub-toggles) — Semonin asked for less email, not more knobs.
- **Marketing blast pipeline** — flag exists and is gated; no sender helper yet. Build when marketing exists.
- **Team-cascade prefs** (broker toggle silences all agents) — needs team-level settings surface that doesn't exist yet. Separate epic.
- **Unsubscribe-link / one-click CAN-SPAM token** — needed for marketing, not for transactional. Defer until first marketing send.
- **Admin override UI** to change a user's prefs from `/admin/users/[id]` — wait until support asks.
- **Fixes to /admin/settings P1–P4** from Auditor B — different scope, separate PR.

---

## 7. Effort estimate (4 parallel specialists, ~3.5h total)

| Phase | Specialist | Work | Time |
|---|---|---|---|
| A — Schema | Prisma specialist | Add 4 User columns + `UserPreferenceChange` model + relation, `npx prisma db push`, `npx tsc --noEmit` | **30 min** |
| B — API | Backend specialist | Extend GET select; add PATCH handler w/ Zod, diff, update, audit; manual curl test | **45 min** |
| C — UI | Frontend specialist | Rewrite Notification Preferences card: state, hydrate, save-on-toggle w/ optimistic+rollback, toast, SMS "Coming soon" row | **60 min** |
| D — Email gating | Backend specialist | Create `lib/email-preferences.ts`; wire `shouldSendEmail` into 6 customer helpers; extend `resolveRefundRecipient` to return id; verify admin/password paths untouched | **75 min** |
| Integration | Lead | `npx tsc --noEmit`, click through profile page, toggle each flag, place test order as test@pinkposts.com with flag off → confirm no email + log line, flip on → confirm email; changelog entry | **30 min** |

**Total: ~4h, parallelizable to ~1.5h wall-clock** (A blocks B and D; C runs fully independent; integration runs last).

**Contracts the 4 specialists must honor (so they don't collide):**
- Column names: exactly `emailOrderConfirmations`, `emailServiceRequests`, `emailMarketing` (camelCase TS, snake_case DB via @map).
- API: `PATCH /api/profile` accepts partial `{ emailOrderConfirmations?, emailServiceRequests?, emailMarketing? }`, returns `{ ok: true, prefs }`.
- Helper signature: `shouldSendEmail(userId: string | null | undefined, flag: Flag): Promise<boolean>` — fails open on error or missing user.
- UI fetches prefs from existing `GET /api/profile` response; no new GET endpoint.