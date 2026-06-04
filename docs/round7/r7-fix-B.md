Clean. All type checks pass.

Files touched:

**1. `C:\Users\tanne\PPI\lib\email.ts`**
- Added exported `ExistingLockboxSummary` interface + two shared formatters (`formatExistingLockboxLine` for plain text, `formatExistingLockboxLineHtml` for HTML) plus an HTML block renderer `renderExistingLockboxesHtml`. Pink-tinted `#FFE4EC` block with `#E84A7A` left border (distinct from the yellow `#FFFBEB`/`#F59E0B` special-instructions block).
- Extended all 4 SR helpers (`sendAdminServiceRequestNotification`, `sendServiceRequestConfirmationEmail`, `sendServiceRequestStatusEmail`, `sendServiceRequestCompletedEmail`) with optional `existingLockboxes?: ExistingLockboxSummary[]` prop. Absent or empty = no section rendered. All interpolated lockbox fields HTML-escaped.

**2. `C:\Users\tanne\PPI\app\api\installations\[id]\service-request\route.ts`**
- Added `include: { lockboxes: { where: { removedAt: null }, include: { lockboxType: true } } }` to the installation fetch, mapped to the `existingLockboxes` prop shape (serialNumber=null since `InstallationLockbox` has no FK back to `CustomerLockbox` yet), passed into both admin + customer emails.

**3. `C:\Users\tanne\PPI\app\api\service-requests\route.ts`**
- Same treatment, but only when the unlisted-address lookup finds an existing installation. Skipped when no installation matched. Passed into both admin + customer emails.

**4. `C:\Users\tanne\PPI\app\api\admin\service-requests\[id]\route.ts`**
- After status update, when status actually transitioned and the SR is tied to an installation, fetched the installation's active lockboxes (`removedAt: null`) and passed `existingLockboxes` into both the completed email and the status email.

Sample lockbox section output (shared formatter — same shape across all 4 templates):

Plain-text block (admin email):
```
Existing lockboxes at this property:
  - Sentrilock/Supra — Serial: TEST-1234  Code: 5678
  - Sentrilock/Supra — Serial: ABC-99
  - Sentrilock/Supra — Code: 2093483
```

HTML block (customer confirmation + status emails) renders each as a `<li>`:
- All fields: `Sentrilock/Supra — Serial: TEST-1234  Code: 5678`
- Serial only: `Sentrilock/Supra — Serial: ABC-99`
- Code only: `Sentrilock/Supra — Code: 2093483`
- Neither: `Sentrilock/Supra — (no code on file)` (handles InstallationLockbox.code=null rows, which the diagnostic noted are ~95% of current rows)

Schema note: `InstallationLockbox` has no `customerLockboxId` FK and no `serialNumber` column today, so `serialNumber` is always emitted as `null` from current call sites — the `serialNumber` field on `ExistingLockboxSummary` is wired through so once the FK schema gap is closed (separate PR), call sites can start populating it without touching email templates again. `npx tsc --noEmit` clean.