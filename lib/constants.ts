// Application Constants

export const APP_NAME = 'Pink Posts Installations'
export const APP_DESCRIPTION = "Central Kentucky's trusted yard sign installation service for real estate professionals."

// Contact Information
export const CONTACT = {
  phone: '859-395-8188',
  email: 'Contact@PinkPosts.com',
  address: '110 Winding View Trail, Georgetown, KY 40324',
}

// Service Areas
export const SERVICE_AREAS = {
  kentucky: [
    'Fayette County',
    'Scott County',
    'Woodford County',
    'Jessamine County',
    'Clark County',
    'Madison County',
    'Bourbon County',
    'Franklin County',
  ],
  ohio: [
    'Hamilton County',
    'Butler County',
    'Warren County',
    'Clermont County',
  ],
}

// Post Types
export const POST_TYPES = {
  WHITE: 'white',
  BLACK: 'black',
  PINK: 'pink',
} as const

// Order Status
export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const

// Installation Status
export const INSTALLATION_STATUS = {
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  REMOVAL_SCHEDULED: 'removal_scheduled',
  REMOVED: 'removed',
} as const

// Invoice Status
export const INVOICE_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
} as const

// Pricing (in dollars)
// NOTE: PRICING.posts is currently unused — the canonical source for post
// installation prices is `components/order-flow/types.ts`'s PRICING.posts
// (used by the order wizard) and the per-page hardcoded values on the
// marketing + dashboard post-options pages. Keep these mirrored in case
// something starts reading them again.
export const PRICING = {
  posts: {
    white: {
      installation: 59,
      replacement: 75,
    },
    black: {
      installation: 59,
      replacement: 75,
    },
    pink: {
      installation: 65,
      replacement: 85,
    },
  },
  riders: {
    standard: 5,
    custom: 10,
  },
  lockboxes: {
    install: 5,
    rental: 10,
  },
  brochureBox: {
    purchase: 23,
    install: 2,
  },
  serviceTrip: 40, // Trip fee for service visits (adding accessories, etc.)
  expedite: 50, // Same-day service fee
}

// Navigation Links
export const NAV_LINKS = {
  marketing: [
    { href: '/posts', label: 'Posts' },
    { href: '/riders', label: 'Riders' },
    { href: '/lockboxes', label: 'Lockboxes' },
    { href: '/faq', label: 'FAQ' },
  ],
  dashboard: {
    main: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/dashboard/post-options', label: 'Post Options' },
      { href: '/dashboard/rider-options', label: 'Rider Options' },
      { href: '/dashboard/lockbox-options', label: 'Lockbox Options' },
    ],
    orders: [
      { href: '/dashboard/place-order', label: 'Place Order' },
      { href: '/dashboard/order-history', label: 'Order History' },
      { href: '/dashboard/invoices', label: 'Invoices' },
    ],
    account: [
      { href: '/dashboard/profile', label: 'Profile' },
    ],
  },
}
