# Changelog

All notable changes to Pink Posts Installations are documented here.
Versions follow [Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH

---

## [4.2.0] — 2026-04-03 (`0759655`)

### Added
- **"Other" inventory category** — admin can track misc items (e.g., metal frames left by agents) with a freeform description field; items appear in customer detail with add/delete controls
- **"Open House/Wire Frame Only" post option** — $0 post selection with full policy disclosure (Friday install after 5pm, Sunday pickup after 5pm, sign responsibility disclaimer, directs to wire frame quantity in step 4)
- **Wire frame installation instructions** — text area appears when quantity > 0; instructions included in order description
- **Service request admin email** — removal and service requests now trigger an email notification to admin (previously only created in-app notifications)

### Fixed
- **Riders greyed out bug** — slug conversion now strips commas and all special characters, so riders like "Under Contract, Taking Backups" correctly match inventory slugs
- **Custom acres/garage selectable without inventory** — custom rider inputs now disabled in "My Riders" mode when the rider type is not in the customer's inventory
- **Lockboxes listed individually** — each lockbox now shown as a separate row with its own code and delete button (previously grouped by type, which merged different codes together)
- **Signs grouped by description** — identical signs consolidated into a single row with quantity count

### Changed
- Sign step label updated: "Sign will be at the property" → "Sign will be at the property or pickup from another location"
- Sign step: removed description input field from "at property" selection

---

## [4.1.0] — 2026-04-02 (`dd09c87`)

### Added
- **Wire Frame Sign Install section** — quantity selector in Riders step at $5 each; line item appears in order review and is passed to the API
- **Scheduling restrictions** — blocks same-day booking, next-day after 4pm EST, and Sunday bookings; expedited option auto-disabled after 4pm; disclaimer banner with policy text shown on scheduling step

### Fixed
- **Login immediately after signup** — emails stored lowercase at signup but matched case-sensitively at sign-in; new accounts appeared locked immediately after creation
- **Password reset not working** — same email case mismatch caused reset emails to silently fail (user not found in DB)
- **Password reset link** — was pointing to `localhost:3000` in production; now uses `NEXT_PUBLIC_APP_URL`

---

## [4.0.0] — 2026-04-01 (`e704459`)

### Added
- **Friendly Stripe error messages** — card declines, insufficient funds, expired cards, lost/stolen, and network errors now show plain-English messages instead of "Internal server error" or "Validation failed"
- **Auto-remove inventory on order** — signs, riders, lockboxes, and brochure boxes automatically marked out of storage when an order is placed
- **Customer profile editing** — admin can edit name, email, phone, and company for any customer
- **Customer deletion** — admin can delete customers (self-deletion prevented)
- **Inventory quantity adjustment** — +/- controls for riders and lockboxes in admin customer detail view
- **Rider inventory status on order form** — customers see which riders are in storage; "My Riders" toggle only appears when inventory exists; amber message shown when no inventory available
- **Promo codes exclude brochure box purchases** — discount applies only to eligible items; note shown in promo success message

### Fixed
- **Lockbox add bug** — case mismatch between frontend value `"sentrilock"` and DB name `"SentriLock"` prevented adding lockboxes; fixed with explicit name mapping
- **Inventory quantity update** — rider and lockbox quantities now adjusted by creating/deleting individual records to match target count (schema uses individual records, not a quantity field)
- **Validation error messaging** — Zod failures now return field-specific messages instead of generic "Validation failed"

---

## [3.2.0] — 2026-03-20 (`a4be2cc`, `8eefbb0`, `24b401a`, `fba00c6`)

### Added
- Metal Frame Sign post option on `/posts` marketing page and in the order wizard
- Order editing for non-completed orders (add/remove riders, lockboxes, brochure boxes, sign options without double-charging fuel surcharge)
- Promo code fuel surcharge waiver option for admins
- Admin order confirmation emails now include full installation details and pricing breakdown
- "Sign in inventory" option always visible; shows helpful error if no signs are in storage
- Order history grouped by status with badges
- $40 no-post surcharge clearly shown in order summary
- Step navigation: visited steps stay active; mobile step dots for quick navigation

### Fixed
- Promo code crash on $0 orders
- Orphaned promo code usage records cleaned up
- Promo code creation validation errors
- Per-customer promo usage tracking
- Mobile checkout modal no longer exceeds viewport
- "Schedule a Trip" dropdown overflow fixed
- Active installations action menu replaced with centered popup overlay

---

## [3.1.0] — 2026-03-10 (`a60c148`, `bc4105d`)

### Added
- Stripe Tax API integration with Kentucky 6% fallback
- Inline payment entry at checkout (Stripe Elements)
- Per-customer promo code usage limits (`maxUses` per customer)
- Installation details captured on order: sign orientation, gated community, gate code, marker placement, installation notes

### Fixed
- Post selection made optional — no-post service trip fee ($40) applies when skipped
- Step indicators now clickable for previously visited steps
- Tax calculation falls back to 6% when Stripe Tax returns 0 (non-taxable classification)
- Sign-out now redirects to homepage instead of `/sign-in`
- Payment method display overlap in checkout resolved

---

## [3.0.0] — 2026-02-15 (`e0baff2`)

### Added
- Contact page
- Lockbox inventory management (SentriLock, Mechanical)
- Full customer inventory system (signs, riders, lockboxes, brochure boxes)
- Pricing updates across all service types

---

## [2.9.2] — 2026-01-20 (`0ca2c48`)

### Security
- Middleware hardening across protected routes
- Rate limiting on authentication routes
- Password strength validation on registration and reset

---

## [2.9.1] — 2026-01-18 (`4e19c8f`)

### Fixed
- Customer detail page: switched to `useParams()` hook (Next.js App Router compatibility)
- Admin customer detail API response format aligned with frontend expectations
- Payment method display overlap in checkout

---

## [2.9.0] — 2026-01-15 (`883780a`)

### Added
- In-app notification system (bell icon in dashboard header)
- Admin notification center
- Service request status change notifications
- 30-day session persistence with cookie duration setting

---

## [2.8.0] — 2026-01-08 (`75648c3`)

### Added
- Forgot password / password reset via email (Resend)
- Mobile dashboard improvements
- Session persistence with 30-day cookie

---

## [2.7.0] — 2025-12-20 (`3a910b2`)

### Added
- Service requests: removal, repair, replacement scheduling from customer dashboard
- "Schedule a Trip" feature for non-installation service visits
- Admin service request management with status updates

---

## [2.5.0] — 2025-12-01 (`a20e85a`)

### Added
- Promo code management in admin settings (create, activate, deactivate, set discount type/value)
- Admin customer detail view with order history and inventory summary

---

## [2.0.0] — 2025-11-15 (`06bb685`, `369f397`)

### Added
- Full order wizard (8-step flow: property → post → sign → riders → lockbox → brochure box → scheduling → review & pay)
- Stripe card-on-file with automatic billing (PaymentIntent + SetupIntent)
- Admin dashboard: order management, customer management, installation tracking
- Railway PostgreSQL + Prisma ORM (migrated from Supabase)
- NextAuth.js authentication with credentials provider
- Email notifications via Resend (order confirmation, admin notification)

---

## [1.0.0] — 2025-10-01 (`cbff856`)

### Added
- Initial production build
- Marketing site (home, posts, about, pricing)
- Customer sign-up and sign-in
- Basic dashboard skeleton
