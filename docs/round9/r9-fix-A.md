tsc clean (exit 0, no errors).

---

## Specialist A Schema — DONE

### Schema diff

`prisma/schema.prisma` — added to `User` model (after `teamId`):
```prisma
// Notification preferences — defaults preserve current send-everything behavior except marketing
emailOrderConfirmations    Boolean   @default(true)  @map("email_order_confirmations")
emailServiceRequests       Boolean   @default(true)  @map("email_service_requests")
emailMarketing             Boolean   @default(false) @map("email_marketing")
notificationPrefsUpdatedAt DateTime? @map("notification_prefs_updated_at")
```

Added reverse relation in `User` model:
```prisma
preferenceChanges UserPreferenceChange[]
```

Appended new model after `AuditLog`:
```prisma
// Per-user notification-preference change log — answers "when did Peggy opt out"
model UserPreferenceChange {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  changedBy   String   @map("changed_by") // actor userId (usually == userId; admin override possible)
  changes     Json     // { emailOrderConfirmations: { from: true, to: false }, ... }
  ipAddress   String?  @map("ip_address")
  userAgent   String?  @map("user_agent")
  createdAt   DateTime @default(now()) @map("created_at")

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("user_preference_changes")
}
```

### db push output
```
Datasource "db": PostgreSQL database "railway", schema "public" at "yamanote.proxy.rlwy.net:50643"
Your database is now in sync with your Prisma schema. Done in 4.35s
```
`npx prisma generate` succeeded (Prisma Client v7.2.0).

### Live verification (queried Railway prod)
```
User column check: {
  "id": "cmlzn3d3e00091do3vz0s7iym",
  "email": "meganmoore0517@gmail.com",
  "emailOrderConfirmations": true,
  "emailServiceRequests": true,
  "emailMarketing": false,
  "notificationPrefsUpdatedAt": null
}
UserPreferenceChange table accessible. row count: 0
```

All 4 new User columns return their defaults on every existing row (additive migration — no user lost email). `user_preference_changes` table created and queryable.

### tsc
`npx tsc --noEmit` — clean (exit 0).

### Contract for downstream specialists
- Column names exactly: `emailOrderConfirmations`, `emailServiceRequests`, `emailMarketing`, `notificationPrefsUpdatedAt` (camelCase TS; snake_case DB via `@map`).
- Audit model name: `UserPreferenceChange` (table `user_preference_changes`). Diff JSON shape: `{ field: { from: boolean, to: boolean } }`.
- No `AuditAction` constant added — `UserPreferenceChange` is its own table, not a generic `AuditLog` row, matching the spec.

Files touched: `C:\Users\tanne\PPI\prisma\schema.prisma`.