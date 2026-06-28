# Pink Post Installations - Production Documentation

## Overview

Pink Post Installations is a premium yard sign installation service platform for real estate professionals in Kentucky and surrounding areas. This documentation covers the production build implementation.

**Repository:** https://github.com/VVSVault/PPI

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14+ (App Router), TypeScript, Tailwind CSS |
| Animations | Framer Motion |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Database | Railway PostgreSQL + Prisma ORM |
| Authentication | NextAuth.js (Credentials Provider) |
| Payments | Stripe (Elements, Payment Intents) |
| Email | Resend |
| Hosting | Railway (current) or Vercel |

---

## Project Structure

```
pink-post-installations/
├── app/
│   ├── (marketing)/          # Public landing pages
│   │   ├── page.tsx          # Homepage
│   │   ├── faq/page.tsx      # FAQ page
│   │   └── layout.tsx
│   │
│   ├── (auth)/               # Authentication pages
│   │   ├── sign-in/page.tsx
│   │   ├── sign-up/page.tsx
│   │   └── layout.tsx
│   │
│   ├── dashboard/            # Customer dashboard
│   │   ├── page.tsx          # Overview
│   │   ├── post-options/     # Post types info
│   │   ├── rider-options/    # Rider types info
│   │   ├── lockbox-options/  # Lockbox types info
│   │   ├── place-order/      # Order wizard
│   │   ├── order-history/    # Past orders
│   │   ├── billing/          # Payment history
│   │   ├── profile/          # User profile
│   │   └── layout.tsx
│   │
│   ├── admin/                # Admin dashboard
│   │   ├── page.tsx          # Admin overview
│   │   ├── customers/        # Customer management
│   │   ├── orders/           # Order management
│   │   ├── settings/         # Business settings
│   │   └── layout.tsx
│   │
│   └── api/                  # API routes
│       ├── orders/           # Order CRUD
│       ├── inventory/        # Customer inventory
│       ├── installations/    # Active installations
│       ├── payments/         # Stripe integration
│       ├── admin/            # Admin endpoints
│       └── webhooks/         # Stripe webhooks
│
├── components/
│   ├── ui/                   # Base UI components
│   ├── marketing/            # Landing page components
│   ├── dashboard/            # Dashboard components
│   ├── order-flow/           # Order wizard steps
│   └── shared/               # Shared components
│
├── lib/
│   ├── prisma.ts             # Prisma client config
│   ├── auth.ts               # NextAuth configuration
│   ├── auth-utils.ts         # Auth helper functions
│   ├── stripe/               # Stripe client/server
│   ├── email.ts              # Email templates
│   ├── validations.ts        # Zod schemas
│   └── utils.ts              # Utilities
│
├── prisma/
│   ├── schema.prisma         # Database schema
│   ├── seed.ts               # Seed data script
│   └── migrations/           # Database migrations
│
├── types/
│   ├── database.ts           # TypeScript types
│   └── next-auth.d.ts        # NextAuth type extensions
│
└── public/
    └── images/posts/         # Post images
```

---

## Features

### 1. Landing Page

**Route:** `/`

- Hero section with tagline: "We take care of the dirty work, so you can focus on closing more deals!"
- Post showcase (White, Black, Pink vinyl posts)
- Rider selection callout (27+ options: Sold, Pending, Coming Soon, etc.)
- Value propositions (6 key benefits)
- Trip services callout
- FAQ section
- CTA banner

### 2. Customer Dashboard

**Route:** `/dashboard`

| Page | Description |
|------|-------------|
| Overview | Stats cards, active installations table |
| Post Options | View available post types and pricing |
| Rider Options | View rider catalog and pricing |
| Lockbox Options | View lockbox types and pricing |
| Place Order | 9-step order wizard |
| Order History | View past orders with status |
| Billing | Payment history with itemized receipts |
| Profile | Account settings |

### 3. Order Wizard

**Route:** `/dashboard/place-order`

The order wizard guides customers through 9 steps:

1. **Property Information** - Address, property type, installation notes
2. **Post Selection** - White ($59), Black ($59), or Pink ($65)
3. **Sign Selection** - Use stored sign, sign at property, or no sign
4. **Rider Selection** - Categorized accordion selector with 27+ options (Sold, Pending, Coming Soon, bedrooms, property features, and more). Rent for $5 or install own for $2
5. **Lockbox Selection** - SentriLock, mechanical (own or rental)
6. **Brochure Box** - Use stored, buy new, or skip
7. **Scheduling** - Next available, specific date, or expedited
8. **Review & Pay** - Order summary with Stripe payment

### 4. Admin Dashboard

**Route:** `/admin`

| Page | Description |
|------|-------------|
| Overview | Business metrics (customers, orders, revenue) |
| Customers | Customer list with inventory counts |
| Customer Detail | View/edit customer inventory (signs, riders, lockboxes) |
| Orders | All orders with status management |
| Settings | Business configuration info |

**Access:** Only users with `role = 'admin'` in the profiles table can access.

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User accounts with Stripe customer ID |
| `post_types` | Post catalog (White, Black, Pink) |
| `rider_catalog` | Rider types (26 options) |
| `lockbox_types` | Lockbox options |

### Customer Inventory

| Table | Purpose |
|-------|---------|
| `customer_signs` | Signs stored for customer |
| `customer_riders` | Riders owned by customer |
| `customer_lockboxes` | Lockboxes owned by customer |
| `customer_brochure_boxes` | Brochure boxes in storage |

### Orders & Installations

| Table | Purpose |
|-------|---------|
| `orders` | Order records with payment status |
| `order_items` | Line items for each order |
| `installations` | Active sign installations |
| `installation_riders` | Riders on active installations |
| `installation_lockboxes` | Lockboxes on active installations |

### Payments

| Table | Purpose |
|-------|---------|
| `payment_methods` | Saved Stripe payment methods |

---

## API Endpoints

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders` | List user's orders |
| POST | `/api/orders` | Create new order |
| GET | `/api/orders/[id]` | Get order details |
| PUT | `/api/orders/[id]` | Update order (admin) |
| DELETE | `/api/orders/[id]` | Cancel order |

### Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inventory` | Get user's full inventory |
| GET | `/api/inventory/signs` | Get user's signs |
| POST | `/api/inventory/signs` | Add new sign |

### Installations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/installations` | List user's installations |
| GET | `/api/installations/[id]` | Get installation details |
| POST | `/api/installations/[id]/schedule-removal` | Schedule removal |
| POST | `/api/installations/[id]/add-rider` | Add rider to installation |
| POST | `/api/installations/[id]/service-request` | Create service/removal request |

### Service Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/service-requests` | List all service requests (admin) |
| GET | `/api/admin/service-requests/[id]` | Get service request details (admin) |
| PUT | `/api/admin/service-requests/[id]` | Update request status (admin) |

### Profile

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profile` | Get user profile |
| PUT | `/api/profile` | Update user profile |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Get user notifications (with unread count) |
| PUT | `/api/notifications` | Mark notifications as read |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/payments/methods` | List saved cards |
| POST | `/api/payments/methods` | Save new card |
| PUT | `/api/payments/methods/[id]` | Set as default |
| DELETE | `/api/payments/methods/[id]` | Remove card |
| POST | `/api/payments/setup-intent` | Create setup intent |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/customers` | List all customers |
| GET | `/api/admin/customers/[id]` | Customer detail |
| PUT | `/api/admin/customers/[id]` | Update customer |
| POST | `/api/admin/customers/[id]/inventory` | Add inventory item |
| DELETE | `/api/admin/customers/[id]/inventory` | Delete inventory item |
| GET | `/api/admin/orders` | List all orders |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhooks/stripe` | Stripe webhook handler |

---

## Pricing Structure

| Item | Price |
|------|-------|
| **Posts** | |
| White Vinyl Post (install & pickup) | $59 |
| Black Vinyl Post (install & pickup) | $59 |
| Signature Pink Post (install & pickup) | $65 |
| Reinstallation (weather/natural) | FREE |
| **Signs** | |
| Install customer's sign | $3 |
| **Riders** | |
| Install customer's rider | $2 |
| Rent a rider | $5 |
| **Lockboxes** | |
| Install SentriLock (customer's) | $5 |
| Install Mechanical (customer's) | $5 |
| Rent Mechanical | $10 |
| **Brochure Box** | |
| Rent brochure box | $5 |
| Install from storage | $3 |
| **Fees** | |
| Fuel Surcharge (all orders) | $3.49 |
| Expedite Fee (same day) | $50 |

---

## Environment Variables

Create a `.env.local` file with these variables:

```env
# Database (Railway PostgreSQL)
DATABASE_URL=postgresql://user:password@host:port/database

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Resend (Email)
RESEND_API_KEY=re_...

# App
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=https://pinkpostinstallations.com

# Admin notifications
ADMIN_EMAIL=contact@pinkposts.com
```

---

## Setup Instructions

### 1. Clone Repository

```bash
git clone https://github.com/VVSVault/PPI.git
cd PPI
npm install
```

### 2. Set Up Railway PostgreSQL

1. Create a Railway account and new project
2. Add a PostgreSQL database
3. Copy the connection URL to your `.env.local` as `DATABASE_URL`

### 3. Set Up Database

```bash
# Run migrations
npx prisma migrate dev

# Seed initial data
npm run db:seed
```

### 4. Set Up Stripe

1. Create a Stripe account
2. Get your API keys from the Stripe Dashboard
3. Set up a webhook endpoint pointing to `/api/webhooks/stripe`
4. Add keys to `.env.local`

### 5. Set Up Resend

1. Create a Resend account
2. Get your API key
3. Add to `.env.local`

### 6. Run Development Server

```bash
npm run dev
```

### 7. Deploy to Railway (Current)

1. Push to GitHub
2. Connect Railway to your GitHub repository
3. Add environment variables in Railway dashboard
4. Railway auto-deploys on push to main

**Alternative: Deploy to Vercel**

1. Push to GitHub
2. Import to Vercel
3. Add environment variables
4. Deploy

---

## Making a User an Admin

To grant admin access:

1. Use Prisma Studio: `npm run db:studio`
2. Or run directly via SQL:

```sql
UPDATE users
SET role = 'admin'
WHERE email = 'user@example.com';
```

**Note:** The seed script creates an admin user: `admin@pinkposts.com` with password `admin123`

---

## Email Notifications

### Customer Emails
- **Order Confirmation** - Sent when order is placed and payment succeeds

### Admin Emails
- **New Order Alert** - Sent immediately when a new order is received
- Includes customer info, property address, and order details

---

## Security

- **Authentication:** NextAuth.js with JWT sessions
- **Password Hashing:** bcrypt with 12 rounds
- **Admin Check:** API routes verify admin role
- **Payments:** Stripe handles all card data (PCI compliant)
- **Input Validation:** Zod schemas on all forms
- **HTTPS:** Enforced via Vercel

---

## File Highlights

### Key Components

| File | Description |
|------|-------------|
| `components/order-flow/order-wizard.tsx` | Main order wizard with step navigation |
| `components/order-flow/steps/*.tsx` | Individual step components |
| `components/order-flow/RiderSelector/` | Categorized rider selection with accordions |
| `components/marketing/hero.tsx` | Landing page hero section |
| `components/marketing/post-showcase.tsx` | Post display section |
| `components/marketing/rider-callout.tsx` | Rider options callout section |
| `components/dashboard/sidebar.tsx` | Dashboard navigation |
| `app/admin/layout.tsx` | Admin layout with auth check |

### Key Libraries

| File | Description |
|------|-------------|
| `lib/prisma.ts` | Prisma client with pg adapter |
| `lib/auth.ts` | NextAuth configuration |
| `lib/auth-utils.ts` | Auth helper functions |
| `lib/rate-limit.ts` | Rate limiting and account lockout |
| `lib/stripe/server.ts` | Stripe server-side utilities |
| `lib/stripe/client.ts` | Stripe client-side loader |
| `lib/email.ts` | Email templates and sending |
| `lib/notifications.ts` | In-app notification helpers |
| `lib/validations.ts` | Zod validation schemas |

---

## Changelog

### v2.9.1 (Security Hardening)

- **New:** Route protection middleware (`middleware.ts`)
  - Protects `/dashboard/*` and `/admin/*` pages
  - Protects API routes requiring authentication
  - Admin routes require admin role
- **New:** Rate limiting for auth endpoints
  - 5 attempts per 15 minutes for login/register
  - Returns 429 with Retry-After header when exceeded
- **New:** Account lockout after failed logins
  - 5 failed attempts locks account for 15 minutes
  - Clear error message with remaining lockout time
- **New:** Password strength validation
  - Minimum 8 characters
  - Requires uppercase, lowercase, and number
- **Improved:** Email stored in lowercase for consistency
- **Added:** `lib/rate-limit.ts` utility with presets

### v2.9.0 (Client Spec Updates & Notifications)

- **New:** Notification system for users
  - Bell icon dropdown in dashboard header
  - Notifications for: order status changes, service request updates, welcome message
  - Mark as read (individual or all)
  - Auto-polls every 30 seconds
  - **Requires migration:** `npx prisma db push` to create `notifications` table
- **New:** Order form questions (per client spec)
  - "Is the property in a gated community?" (Yes/No + gate code field)
  - "Did you leave a marker where you want the post placed?" (Yes/No)
  - "How should the sign be placed relative to the street?" (Perpendicular, Parallel, Corner Angle, Let Installer Decide, Other)
- **Updated:** Dashboard now fetches real data from API
  - New users see empty state with CTA instead of mock data
  - Stats calculated from actual orders and installations
- **Updated:** Logo navigation
  - Links to `/dashboard` when user is on dashboard/admin pages
  - Links to `/` (home) on marketing pages
- **Updated:** Pricing changes per client spec
  - Expedite fee: $25 → $50 (same day or next day after 4pm)
  - Lockbox rental: $15 → $10 (includes lockbox + installation)
  - Brochure box install: $2 → $3
  - Brochure box rental: NEW $5 option (replaces "buy new" option)
- **Removed:** Replacement charges from Post Options cards
  - Only shows "Installation & Pickup" price now
  - Fees will be in terms & conditions instead
- **Fixed:** Admin orders API returning wrong field names (camelCase vs snake_case)
- **Fixed:** Missing PUT handler for order status updates

### v2.8.0 (Branding Updates)

- **New:** Pink bird mascot logo replaces CSS-styled logo
- **Updated:** Logo component uses Next.js Image component
- **Updated:** Marketing header logo size increased (56x56, h-20 navbar)
- **Updated:** Documentation with branding changes

### v2.7.0 (Service Requests & Installation Actions)

- **New:** ServiceRequest model for tracking service/removal requests
  - Types: removal, service, repair, replacement
  - Status workflow: pending → acknowledged → scheduled → in_progress → completed
  - Stores customer notes, admin notes, requested date, completion date
  - **Requires migration:** `npx prisma migrate dev --name add_service_requests`
- **New:** Active installations dropdown menu actions
  - **View Details**: Modal showing installation info, riders, lockboxes, service history
  - **Schedule Removal**: Modal with date picker to request sign removal
  - **Request Service**: Modal to submit repair/service/replacement requests
- **New:** Admin service requests page (`/admin/service-requests`)
  - Status cards with counts (Pending, Acknowledged, Scheduled, In Progress, Completed)
  - Clickable filters by status and request type
  - Detail modal with ability to acknowledge, schedule, mark complete, or cancel
  - Admin notes field for internal tracking
  - Auto-updates installation status when removal is completed
- **New:** Service requests API endpoints
  - `GET /api/installations/[id]` - Fetch installation details with related data
  - `POST /api/installations/[id]/service-request` - Create service/removal request
  - `GET /api/admin/service-requests` - List all requests with counts (admin)
  - `GET/PUT /api/admin/service-requests/[id]` - Get/update request (admin)
- **Updated:** Admin dashboard overview
  - New "Service Requests" card showing pending count
  - Orange ring highlight when requests need attention
  - Links directly to service requests page
- **Updated:** Admin sidebar with Service Requests nav item
- **Updated:** Replacement fee policy
  - Removed replacement fee mentions from all public-facing pages
  - Removed from: lockbox-options, rider-options, riders page, posts page
  - Added disclosure to order review step: "Lost, damaged, or unreturned rental items are subject to replacement fees"

### v2.6.0 (Spec Verification & Fixes)

- **New:** Installation location image attachment feature
  - Paperclip button on installation location field allows photo uploads
  - Image preview with remove option
  - Max 5MB, validates image file type
  - Stored as base64 in database
  - **Requires migration:** `npx prisma migrate dev --name add_installation_location_image`
- **New:** Order confirmation page (`/dashboard/order-confirmation`)
  - Shows order details, items, and totals after successful order
  - "What's Next" section explaining installation process
  - Links to order history and place another order
- **New:** Profile API endpoint (`/api/profile`)
  - GET: Fetch user profile (name, email, phone, company)
  - PUT: Update profile fields
- **New:** Single order API endpoint (`/api/orders/[id]`)
  - GET: Fetch order details for confirmation page
- **Updated:** Lockbox options page with correct pricing
  - Realtor Bluetooth Lockbox: $5 install (customer-owned)
  - Mechanical (Your Own): $5 install
  - Mechanical (Rental): $10 (includes lockbox + installation)
- **Updated:** RiderSelector with rental terms link
  - "View Rental Terms & Conditions" link opens /riders#terms in new tab
  - Added `id="terms"` anchor to riders page terms section
- **Updated:** Profile page with real data persistence
  - Loads profile from API on mount
  - Saves changes via PUT /api/profile
  - Shows loading state
- **Removed:** Invoices page (not needed per spec - payment at order time)
  - Deleted `/dashboard/invoices/page.tsx`
  - Deleted `components/dashboard/invoice-table.tsx`
  - Updated notification preferences wording (invoices → orders)

### v2.5.0 (Admin Dashboard Enhancements)

- **New:** Global inventory overview page (`/admin/inventory`)
  - Summary cards showing total signs, riders, lockboxes, brochure boxes
  - Filter by item type (All, Signs, Riders, Lockboxes, Brochure Boxes)
  - Search by description or customer name
  - Links to customer detail pages for management
- **New:** Email configuration API (`/api/admin/settings/email`)
  - GET: Returns Resend API status, admin email, from address
  - POST: Send test email to verify configuration
- **Updated:** Admin settings page with live email configuration
  - Shows Resend API configured/not configured status
  - Displays admin email and from address
  - "Send Test Email" button with success/error feedback
  - Displays business pricing settings (fuel surcharge, expedite fee, rider prices)
- **Updated:** Admin sidebar logo with color-aware branding
  - "Pink" in white, "Post" in pink, "Admin" in gray

### v2.4.0 (Inventory-Aware Selection)

- **Updated:** Order flow is now fully inventory-aware
  - Shows cheaper "from storage" options ($2) when customers have inventory
  - Falls back to rental/new options when no inventory available
- **Updated:** `/api/inventory` endpoint now returns properly formatted data
  - Signs: `{ id, description, size }`
  - Riders: Aggregated by type with quantity counts
  - Lockboxes: `{ id, lockbox_type, lockbox_code }`
  - Brochure boxes: `{ quantity }` or null
  - Filters to only items currently in storage
- **Updated:** Review step shows source distinction per spec
  - Riders: "Rider Install: [Type] (from storage)" or "Rider Rental: [Type]"
  - Signs: "Sign Install (from storage)" vs "Sign Install"
  - Brochure box: "Brochure Box Install (from storage)" or "Brochure Box (New)"
- **Updated:** OrderItem model with new fields
  - `itemCategory`: 'storage', 'rental', 'new', or 'owned'
  - Reference IDs: `customerSignId`, `customerRiderId`, `customerLockboxId`, `customerBrochureBoxId`
  - `customValue`: For custom acres or other custom inputs
- **Updated:** Order submission saves item categories and inventory references
- **Note:** Requires database migration: `npx prisma migrate dev`

### v2.3.0 (Rider Selector Redesign & Lockbox Update)

- **New:** RiderSelector component with categorized accordion UI
  - Popular riders section for quick access (Sold, Pending, Coming Soon, For Sale)
  - Category accordions: Status, Bedrooms, Property Features, Rental & Lease, Special
  - Custom Acres input with live preview
  - Source toggle: "My Riders" ($2) vs "Rent Riders" ($5)
  - Selected riders summary with total pricing
- **New:** RiderCallout component on landing page showcasing rider options
- **Updated:** Rider Options dashboard page with accordion-style category browsing
- **Updated:** Order wizard Step 4 now uses the new RiderSelector
- **Removed:** Riders link from landing page navbar (content now in callout section)
- **Removed:** Supra eKey lockbox option (AZ-specific, not available in Kentucky)

### v2.2.0 (Build Fixes & UI Updates)

- **Security:** Upgraded Next.js to 14.2.35 (fixes CVE-2025-55184, CVE-2025-67779)
- **Build Fixes:**
  - Fixed ESLint errors (escaped quotes in JSX)
  - Fixed Badge component variant types (use `info`/`neutral` instead of `default`/`secondary`)
  - Added `helperText` prop to Input component
  - Added `post_type` to order validation schema
  - Fixed Stripe webhook to use `findFirst` then `update` (non-unique field handling)
  - Made Resend and Stripe clients lazy-initialized (prevents build-time API key errors)
  - Simplified prisma.config.ts (removed invalid properties)
- **UI Updates:**
  - Updated post showcase styling ("White, Black, Pink" text colors without backgrounds)

### v2.1.0 (Railway Migration)

- Migrated from Supabase to Railway PostgreSQL
- Replaced Supabase Auth with NextAuth.js
- Added Prisma ORM for database access
- Added pg adapter for Prisma 7 compatibility
- Created database seed script
- Updated all API routes to use Prisma
- Added bcrypt password hashing

### v2.0.0 (Production Build)

- Added multi-step order wizard (9 steps)
- Added admin dashboard with customer/inventory management
- Added Stripe payment integration
- Added email notifications via Resend
- Added billing history page
- Updated landing page with production messaging
- Complete database schema
- Full TypeScript types for all tables

### v1.0.0 (Initial Build)

- Basic Next.js setup with Tailwind CSS
- Marketing pages
- Dashboard layout
- UI component library
- Supabase integration (auth)

---

## Known Gaps (Must Fix Before Production)

### 1. Order History Uses Mock Data
**File:** `app/dashboard/order-history/page.tsx`
- Currently displays hardcoded sample data
- Needs to fetch from `/api/orders` endpoint

### 2. Missing Order Details Page
**Missing:** `app/dashboard/orders/[id]/page.tsx`
- Notifications link to this non-existent page
- Customers clicking order notifications get 404

### 3. Installation Items Not Created
**File:** `app/api/orders/[id]/route.ts`
- When order → completed, creates Installation record
- Does NOT create InstallationRider/InstallationLockbox records
- Customer inventory not updated (in_storage → in_use)

### 4. No Customer Service Requests Page
**Missing:** `app/dashboard/service-requests/page.tsx`
- Customers can only view requests via Installation Details modal
- No dedicated page to see all their service requests

### Medium Priority Issues
| Issue | Description |
|-------|-------------|
| No status validation | Orders can transition to any status |
| Payment failure handling | No notification on Stripe payment failure |
| No scheduling UI | Admin can't set scheduledDate after order creation |
| Expedited orders | Not highlighted in admin order list |

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/VVSVault/PPI/issues
- Developer: Tanner Carlson / VVS Vault LLC
