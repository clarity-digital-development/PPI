# Changelog

All notable changes to Pink Posts Installations are documented here.
Versions follow [Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH

---

## [4.8.1] — 2026-05-26

Four client-reported order issues. Each was verified against the live code first (none were actually fixed before), then re-verified end-to-end in a real browser session (Playwright) against the production database.

### Fixed
- **Service date showing a day early (customer view)** — The customer-facing order detail page rendered the scheduled date in the browser's local timezone, so a date stored at noon-UTC displayed as the day before in US timezones. (The admin pages had already been switched to UTC; the customer page was missed.) `formatShortDate` now renders with `timeZone: 'UTC'` while the "Placed on" timestamp stays local. **Verified:** an order scheduled for May 28 now shows "May 28, 2026".
- **Couldn't change or add the post when editing an order** — The edit screen hard-locked the post ("Post type cannot be changed after ordering"). The post is now a full dropdown (White / Black / Signature Pink / Metal Frame / Wood Panel / Open House / No post). The edit API resolves the new post type, recreates the post line item, and recomputes subtotal + no-post surcharge + tax. **Verified:** changed Signature Pink → Metal Frame, saved, order recomputed from $65 to $40 subtotal.
- **Post step opened halfway down the page** — The order wizard never reset scroll position between steps, so advancing to Post Selection left the customer mid-page. Added scroll-to-top on every step transition. **Verified:** scrolled 924px down, clicked Continue, landed at the top of the Post step.
- **Lockbox had no "available for pickup" option** — Lockbox only offered from-inventory / rent / none. Added an "at property / available for pickup" option (customer's own lockbox installed on-site, $5 install fee, optional code field) in both the place-order and edit flows — matching the existing sign and rider "at property" options.

---

## [4.8.0] — 2026-05-24

### Added
- **Address autocomplete** — The street-address field on the order form now uses Google Places autocomplete; selecting a suggestion auto-fills street, city, state, and ZIP. Falls back to a plain text input when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` isn't configured, so the form keeps working without the key.

### Changed
- **Cart checkout is now a single combined charge** — Previously the cart placed each order as its own Stripe transaction (N charges on the statement). The new `/api/orders/batch` endpoint creates ONE PaymentIntent for the combined total and all orders share it, so the customer sees a single line on their statement. The webhook updates every order in the batch together; 3DS is handled once for the whole charge.
- **My Inventory page scroll** — Each section (signs / riders / lockboxes) now caps at ~5 rows and scrolls internally instead of expanding the card indefinitely, keeping the 2-column grid balanced for agents with 50+ items.
- **Dropdown polish** — The shared `Select` component got a consistent rounded-lg / hover / focus / shadow treatment; the cart's payment-method picker now uses it.

### Fixed
- **Railway build failure** — `useSearchParams()` on `/dashboard/place-order` needed a `<Suspense>` boundary for the production build to prerender. Wrapped it; build is green.

---

## [4.7.0] — 2026-05-22

Team-admin accounts for real-estate teams (first: Peggy Heckert / Semonin Realtors) and a cart for placing multiple orders at once.

### Added
- **Team admin role + cart batch ordering** — A team-admin account manages a team as a single login. They build a cart of multiple orders (each labeled with the agent who sold the property) and check out all at once. Cart is localStorage-backed with a header badge; on the review step a team-admin sees an "Agent who sold this property" field and an "Add to Cart" action.
- **Agent attribution** — Orders carry an optional `placedForAgentName`, shown on the admin order detail as a "Sold by agent" banner.
- **Cart enabled for internal admins too** — so `admin@pinkposts.com` can use/test the same batch flow.

### Changed
- **Re-scoped the team model** — Initially built as "admin places orders on behalf of separate agent accounts," then re-scoped per clarification: a team-admin is one account that labels each order with a free-text agent name (no separate per-agent user records). The on-behalf-of plumbing remains as a latent capability for Pink Posts internal admins.

---

## [4.6.0] — 2026-05-21

Large client feedback batch plus the inventory auto-removal bug that was the owner's main concern.

### Added
- **Wood Panel Post** — New commercial post option ($95, 4ft × 6ft, two beams) with tiered add-ons: +$55 "I need my sign built" → +$55 "I need materials (4×4 posts, screws, washers)". Max combined $205.
- **Rider "At Property" option** — Third source toggle alongside My Riders / Rent Riders, for a customer's own rider installed on-site ($2 install). Works in both the first-post and second-post steps.
- **Unlisted-address service requests** — Service/removal requests can now be placed for an address Pink Posts hasn't installed at (e.g. picking up a competitor's leftover signs), charged the $40 trip fee. Schema gained a nullable installation link + unlisted-address fields; admin and customer views show the address with an "(unlisted)" tag.
- **Service request admin email** — Removal/service requests now email the admin with the customer's contact info, notes, and — for removals — what was originally installed at the address (so the crew knows what to bring back). Customers get a completion email when a request is marked done.

### Fixed
- **Inventory auto-removal was inconsistent (Ryan's main complaint)** — Audit found two root causes: (1) riders selected "from storage" never had their inventory record linked to the order, so they were never marked out; (2) the order-EDIT flow stripped inventory links and never updated stock either direction. Riders now link correctly on placement, signs require a specific selection, and the edit flow transactionally restores removed items and marks added ones out. Backfilled 6 actively-deployed signs that were wrongly showing as in-storage.
- **Mechanical lockbox couldn't be added to inventory** — Admin got "Invalid lockbox type" because the frontend sent `"mechanical"` while the DB had "Mechanical (Customer Owned)" / "Mechanical (Rental)". Fixed the type mapping and split the dropdown into both options.
- **Lockbox inventory selection on the order form** — Customers can now pick the specific lockbox (with its code/serial) from inventory, rather than a generic type.
- **Removal/service-request dates were a day early** — All service-request date writes now store at noon UTC (matching the order fix).
- **Removal scheduling ignored the 4pm / Sunday cutoff** — The "Schedule a Trip" modal now enforces the same rules as install orders (no Sundays, no same-day after 4pm EST), via a shared `lib/scheduling.ts`.

### Changed
- **Brochure box pricing** — Install $2 → $3, purchase $23 → $24.
- **"Perpendicular" sign-orientation description** — Updated to "90 degree angle to the street".
- **"Add Riders" → "Riders & Extras"** heading on step 4.

---

## [4.5.0] — 2026-05-12

End-to-end recovery for orders where the bank requires 3-D Secure (the cause of several "stuck" orders, e.g. PJ Elder's $92.57).

### Fixed
- **3DS challenge now fires during checkout** — The checkout flow never called Stripe's `handleNextAction()`, so when a bank required 3DS the order silently parked in "requires_action" and the customer never saw the verification popup. Now the bank's challenge appears at checkout.
- **Complete Payment button** — Order detail page shows a "Complete Payment" banner for any order with an unfinished 3DS, letting the customer resume the bank's verification after the fact.
- **Abandoned-3DS recovery** — If a customer closes the popup, they're redirected to the order detail page (where the Complete Payment banner takes over) instead of hitting a dead end. If the intent times out into a hard failure, a clear "Payment did not complete — you have not been billed" banner appears with a "Place a New Order" button.
- **Inventory restored on failed/cancelled payments** — `payment_intent.payment_failed` and `payment_intent.canceled` webhooks now release any inventory that was reserved at order creation, so a failed 3DS doesn't permanently lock a customer's signs.

### Added
- **Admin "Cancel Order" button** — One-click cancel on the admin order detail page: cancels the Stripe PaymentIntent, restores linked inventory, and marks the order cancelled. Manual escape hatch for any future stuck order.

---

## [4.4.1] — 2026-04-27

### Fixed

- **Sign inventory mismatch (Ashley Barreto bug)** — Admin customer detail showed "1 sign in storage" but the customer's order form correctly showed "no signs in inventory."
  - **Why it was broken:** Once a sign is used in an order, it's marked `inStorage: false`. The customer-facing inventory API correctly filtered on that flag, but the admin's GET endpoint pulled all sign records regardless of status, so deployed signs incorrectly appeared as available stock.
  - **How it's fixed:** Admin "in Storage" sections now filter by `inStorage: true` so admin and customer views always agree. A new "Currently Deployed" panel below the inventory grid lists out-of-storage items with a per-item "Return to inventory" button — admin can click it the moment the customer physically returns the sign/rider/lockbox/brochure box, and it goes back into rotation. Backed by a new `action: 'return_to_storage'` on the inventory PATCH endpoint.

- **Admin customers list cut off** — Owner couldn't find Oxana in the customers list, but search returned her instantly.
  - **Why it was broken:** The `/api/admin/customers` GET endpoint capped results at 50 by default. Pink Posts has 60+ customers, so anyone past row 50 was silently hidden, and the UI gave no indication the list was truncated.
  - **How it's fixed:** Default limit raised to 500 (well clear of current customer count), and the API now returns a `total` count. The customers page header shows "60 total" or "Showing X of Y" so any future cutoff is immediately visible.

- **Hero looked cramped on mobile** — On phones the landing page showed three overlapping value strips (social proof, key points checklist, hero image with floating badges) plus the next section peeking up below.
  - **Why it was broken:** The bottom key-points list ("Next Day Installation", "One Low Fee", "We Store Your Inventory") repeated content from the social-proof strip ("Next-day install · KY & OH coverage · Loved by agents"); the right-column hero image stacked below the content on mobile and ate vertical space; and the section had no minimum height, so the next section sat directly below the CTAs.
  - **How it's fixed:** Removed the redundant key-points list (also kills the misaligned check-mark layout when the second item wrapped). Hid the hero image on mobile (`hidden lg:block`) — desktop still gets it. Added `min-h-[calc(100svh-5rem)]` and vertical centering on mobile so the hero fills the viewport on initial load and the next section reveals only on scroll.

### Added

- **Click-to-expand solar lighting image** — The night photo of solar lighting in the Riders & Extras step (and Second Post step) now expands inline when tapped and collapses again on tap, with a subtle zoom-in cursor and hover affordance. New reusable `<ExpandableImage>` component.

---

## [4.4.0] — 2026-04-26

### Added
- **Solar Lighting** add-on in Riders & Extras step — $5 per light with photo of installed product; description explains directional placement vs both-sides
- **Second Post step** — new step inserted after Riders, asking "Do you need a second post?" at +$25; if yes, expands collapsible sections for the second post's sign, riders, wire frame signs, and solar lighting (each pulling from the same customer inventory)
- **Second Post install location** — notes textarea for placement instructions on the second post

### Fixed
- **Mechanical lockbox add error** — admin couldn't add Mechanical lockboxes because frontend sent `"mechanical"` while DB had `"Mechanical (Customer Owned)"` and `"Mechanical (Rental)"`; added explicit type mapping and split the dropdown into both options

### Changed
- **"Add Riders" → "Riders & Extras"** — heading on step 4 renamed to reflect new add-ons (stepper indicator stays "Riders" for compactness)
- **Homepage modernized** — Hero, PostShowcase, ValueProposition, and CTABanner refreshed with framer-motion micro-interactions, animated gradients, floating decorative blobs, glass-morphism stat cards, and tighter typography. Respects `prefers-reduced-motion`. New social-proof strip in hero ("Next-day install", "KY/OH coverage", "Loved by agents") and floating "500+ installs" badge

---

## [4.3.0] — 2026-04-06 (`1d20d30`)

### Fixed
- **Date off-by-one bug** — orders scheduled for Monday were showing as Sunday in admin; dates now stored as noon UTC and displayed with UTC timezone to prevent EST shift
- **Rider inventory display** — "My Riders" now shows a simple flat list of the customer's actual inventory riders instead of the category grid; fixes riders like "Love It, Buy It" that didn't appear in any standard category (Popular, Status, etc.)
- **Sign dropdown duplicates** — if a customer has 4x "FOR SALE" signs, the dropdown now shows one entry instead of four; removed redundant "Choose a sign..." placeholder
- **Sign description missing from orders** — orders now include the specific sign selected (e.g., "Sign Install: PVC Hard (from storage)") instead of generic "Sign Install (from storage)"
- **Inventory not removing on order** — inventory removal was working (marking `inStorage: false`) but wasn't visible because orders didn't specify which sign was selected; now the sign description flows through the order so admin can confirm the correct item was pulled from inventory

### Changed
- **Post step default** — Signature Pink Post is now pre-selected instead of "No Post Needed"
- **Sign step default** — "Sign will be at the property" is now pre-selected instead of "No sign needed"
- **"No sign needed" warning** — now displays: "Attention: No sign will be attached and only the post will be installed at your property."
- **Admin orders table** — first column changed from order creation date to requested install date for easier scheduling

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
