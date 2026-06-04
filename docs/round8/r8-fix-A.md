Typecheck passes clean.

---

**Files touched:**

- `c:\Users\tanne\PPI\app\api\orders\[id]\route.ts`
  - Only call site of `prisma.installationLockbox.create` in the codebase (confirmed via grep). Located in the admin order-update PUT handler, inside the `status === 'completed'` block where each `OrderItem` (`itemType='lockbox'`) is fanned out into an `InstallationLockbox` row.
  - Added `customerLockboxId: item.customerLockboxId ?? null` to the `data` payload so new installs preserve the FK back to inventory. The existing `code` copy from `customerLockbox.code` (lines 238-242) was already in place and remains unchanged. When `item.customerLockboxId` is null (legacy rental / new-from-stock flow), the FK stays null — existing behavior preserved.

**New `installationLockbox.create` payload shape:**

```ts
await prisma.installationLockbox.create({
  data: {
    installationId: installation.id,
    lockboxTypeId,
    isRental,
    code,                                                  // snapshot at install time
    // WHY: link back to inventory CustomerLockbox so SR emails can show live code/serial
    customerLockboxId: item.customerLockboxId ?? null,    // NEW — FK to CustomerLockbox
  },
})
```

**Verification:** `npx tsc --noEmit` ran clean (no output, exit 0). No other create sites exist (`InstallationLockbox` only appears as a type/comment elsewhere in `app/` and `lib/` — never as a `.create(...)`).