Schema migration complete. Reporting results.

---

**Schema diff (prisma/schema.prisma):**
```diff
@@ CustomerLockbox @@
   user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
   lockboxType LockboxType @relation(fields: [lockboxTypeId], references: [id])
+  installationLockboxes InstallationLockbox[]

@@ InstallationLockbox @@
   id              String       @id @default(cuid())
   installationId  String       @map("installation_id")
   lockboxTypeId   String       @map("lockbox_type_id")
+  customerLockboxId String?    @map("customer_lockbox_id")
   isRental        Boolean      @default(false) @map("is_rental")
   code            String?
   ...
-  installation    Installation @relation(fields: [installationId], references: [id], onDelete: Cascade)
-  lockboxType     LockboxType  @relation(fields: [lockboxTypeId], references: [id])
+  installation    Installation     @relation(fields: [installationId], references: [id], onDelete: Cascade)
+  lockboxType     LockboxType      @relation(fields: [lockboxTypeId], references: [id])
+  customerLockbox CustomerLockbox? @relation(fields: [customerLockboxId], references: [id], onDelete: SetNull)

+  @@index([customerLockboxId])
   @@map("installation_lockboxes")
```

**`npx prisma db push --accept-data-loss` output:**
```
Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "railway", schema "public" at "yamanote.proxy.rlwy.net:50643"
Your database is now in sync with your Prisma schema. Done in 2.96s
```

**`npx prisma generate`:** Generated Prisma Client (v7.2.0) successfully.

**Verification result (against live Railway DB):**
- `prisma.installationLockbox.findFirst({ select: { customerLockboxId: true } })` returns: `{"id":"cmmjd7ark000m1dowvp4p06sj","customerLockboxId":null,"code":null}` — field is in client types and queryable.
- Row counts: `total=19  withFk=0` (all 19 historical rows have NULL `customerLockboxId`, awaiting backfill agent).

**`npx tsc --noEmit`:** Passed with no errors.

**Files changed:**
- `c:\Users\tanne\PPI\prisma\schema.prisma` (only file modified)

Live DB column `installation_lockboxes.customer_lockbox_id` (nullable, FK→`customer_lockboxes.id` ON DELETE SET NULL) plus index `installation_lockboxes_customer_lockbox_id_idx` are now in place. Ready for the install-time write-path agent and the backfill agent.