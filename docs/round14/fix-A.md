Clean. Done.

---

## Specialist A — Schema + API + Constants — COMPLETE

### 1. Schema diff — `c:\Users\tanne\PPI\prisma\schema.prisma`
Added to `User` model (after `notificationPrefsUpdatedAt`):
```prisma
// Policy-notice acceptance — modal shown to non-exempt users on next dashboard
// load when policyNoticeVersion < CURRENT_NOTICE_VERSION (see lib/policy-notices.ts).
// Defaults make every existing user re-see v1 once; team_admin/admin are exempt.
policyNoticeAcceptedAt DateTime? @map("policy_notice_accepted_at")
policyNoticeVersion    Int       @default(0) @map("policy_notice_version")
```

### 2. DB push log
`npx prisma db push --accept-data-loss` against `yamanote.proxy.rlwy.net:50643/railway`:
> "Your database is now in sync with your Prisma schema. Done in 4.08s"

`npx prisma generate` → "Generated Prisma Client (v7.2.0) in 145ms"

DB probe confirmed live column existence on a real user row: `policyNoticeAcceptedAt=null`, `policyNoticeVersion=0`.

### 3. Audit constant — `c:\Users\tanne\PPI\lib\audit.ts`
Added to `AuditAction`:
```ts
PolicyNoticeAccepted: 'policy_notice.accepted',
```

### 4. Constants file — `c:\Users\tanne\PPI\lib\policy-notices.ts` (NEW, ~70 LOC)
Exports:
- `CURRENT_NOTICE_VERSION = 1`
- `PolicyNotice`, `PolicyNoticeSection` interfaces
- `CURRENT_NOTICE` — full notice object with Ryan's verbatim strings (`modalTitle`, `intro`, two `sections`, `checkboxLabel`, `ctaLabel`)
- `POLICY_NOTICES` — back-compat alias for `CURRENT_NOTICE.sections` (the spec referenced both shapes)
- `isPolicyExempt(user)` — true for `team_admin || admin || isServiceAreaExempt`
- `shouldShowPolicyNotice(user)` — exempt-check + version-gate combined

### 5. API endpoint — `c:\Users\tanne\PPI\app\api\profile\accept-notice\route.ts` (NEW, ~75 LOC)
`POST /api/profile/accept-notice`
- Auth via `getCurrentUser()` → 401 if unauthenticated
- Exempt users → 200 `{ ok: true, exempt: true }` no-op (stale tab safety)
- Body validated by Zod: `{ version: number }` where `1 ≤ version ≤ CURRENT_NOTICE_VERSION` (rejects v999)
- 400 on bad JSON or invalid version
- Updates `policyNoticeAcceptedAt = new Date()` + `policyNoticeVersion = body.version`
- Writes audit row via existing `audit()` helper: `action='policy_notice.accepted'`, `targetType='User'`, `targetId=user.id`, `metadata={version}`, IP/UA captured from request
- Returns 200 `{ ok: true, policyNoticeAcceptedAt, policyNoticeVersion }`

### Verification
- `npx tsc --noEmit` → clean exit, no errors
- Live DB probe confirmed both new columns queryable through Prisma client

### Contract for Specialist B (modal/wiring)
- Import `CURRENT_NOTICE` + `shouldShowPolicyNotice` from `@/lib/policy-notices`
- POST `/api/profile/accept-notice` with `{ version: notice.version }`
- On 200, hide the gate (server layout re-render on next nav will not render it because DB version now matches)