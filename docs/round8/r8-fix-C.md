All three call sites pass clean. The single tsc error is in `scripts/_backfill-installation-lockbox-fk.ts`, which belongs to the parallel backfill agent (not my scope).

---

**Files touched:**

1. `c:\Users\tanne\PPI\app\api\installations\[id]\service-request\route.ts`
   - Added `customerLockbox: { select: { code: true, serialNumber: true } }` to the `lockboxes` include.
   - Updated map to prefer live FK data with fallback to legacy `.code`.

2. `c:\Users\tanne\PPI\app\api\service-requests\route.ts`
   - Added `customerLockbox: { select: { code: true, serialNumber: true } }` to the `lockboxes` include.
   - Updated map (in the `installation ? ... : []` branch) to prefer live FK data with fallback.

3. `c:\Users\tanne\PPI\app\api\admin\service-requests\[id]\route.ts`
   - Added `customerLockbox: { select: { code: true, serialNumber: true } }` to the inner `installationWithLockboxes` include (used only for status-transition emails).
   - Updated map to prefer live FK data with fallback.

**New include shape (applied identically at all three sites):**

```ts
lockboxes: {
  where: { removedAt: null },
  include: {
    lockboxType: true,
    // Prefer live inventory code/serial via FK; fall back to legacy .code copy.
    customerLockbox: { select: { code: true, serialNumber: true } },
  },
}
```

(Note: file 3 wraps this under `installationWithLockboxes.lockboxes` — no `where` filter omitted, kept `where: { removedAt: null }` as in the original.)

**New map function (applied identically at all three sites):**

```ts
installation.lockboxes.map(lb => ({
  type: lb.lockboxType.name,
  serialNumber: lb.customerLockbox?.serialNumber ?? null,
  code: lb.customerLockbox?.code ?? lb.code ?? null,
}))
```

**tsc result:** Clean for all three target files. Sole remaining error (`scripts/_backfill-installation-lockbox-fk.ts:172`) belongs to the parallel backfill agent and is outside this task's scope.

**Behavior:** Post-FK rows (new installs + successfully backfilled rows) render fresh live inventory data in the "Existing lockboxes at this property" SR-email block. Pre-FK legacy rows that the backfill couldn't resolve fall back to the `InstallationLockbox.code` copy (still rendered as `(no code on file)` when null, via the existing formatter behavior).