// Policy-notice acceptance modal — shared contract between the schema/API
// specialist and the modal/wiring specialist. The strings here are Ryan's
// VERBATIM copy from the 6/2 directive — do not paraphrase. Version bumps
// trigger re-acceptance (User.policyNoticeVersion < CURRENT_NOTICE_VERSION).

export const CURRENT_NOTICE_VERSION = 1

export interface PolicyNoticeSection {
  id: string
  title: string
  body: string
}

export interface PolicyNotice {
  version: number
  modalTitle: string
  intro: string
  sections: PolicyNoticeSection[]
  checkboxLabel: string
  ctaLabel: string
}

export const CURRENT_NOTICE: PolicyNotice = {
  version: CURRENT_NOTICE_VERSION,
  modalTitle: 'Notice to Realtors:',
  intro:
    'Pink Posts strives to keep pricing as cheap as possible to keep our services attainable for all agents. In doing so, as we grow as a company, so do our expenses so from time to time, we do need to make adjustments to our pricing structure.',
  sections: [
    {
      id: 'out-of-area-fee',
      title: 'New: Out of Area Fee (click here for information)',
      body:
        'Starting today, all future orders that our in rural areas will need to have a one time $50 out of area fee. This will include pickup and install. The reason for this is we pay our employees $25 hourly and when they need to drive one hour one way for a single sign, that incurs two hours for the installation and two hours for the pickup. This will actually be a loss for the company, but we still want to accommodate our agents that have those further out properties as much as possible. The charge will be added when you place the address in our system. Thank you for your understanding and any additional questions, please let us know!',
    },
    {
      id: 'post-rental-fee',
      title: 'Clarification: Post Rental Fee after 6 months (click here for information)',
      body:
        'This rental structure was in the initial terms and conditions but it appears it may have been missed by some. Our post service costs less than that of a post itself. So if someone wanted to buy a post, it would be cheaper for us to come out and install and then never contact us again. When you order, your initial install cost includes 6 months worth of rent of the post. On the 6 month anniversary date of an active listing, you will be charged $18 for another 3 months. On the 9 month anniversary date, you will be charged $18 for another 3 months. After a year, it is $6 per month that is charged. This will cease of course when the post is scheduled for pickup and will not apply at all if the post is picked up prior to the 6 month anniversary date. Thank you for your understanding and any additional questions, please let us know!',
    },
  ],
  checkboxLabel: 'I have read and understand these adjustments',
  ctaLabel: 'Continue to my dashboard',
}

// Convenience back-compat alias — modal/wiring spec referenced POLICY_NOTICES
// as the array; expose both shapes so either import keeps compiling.
export const POLICY_NOTICES: readonly PolicyNoticeSection[] = CURRENT_NOTICE.sections

// WHY: mirrors lib/service-area.ts:134 exemption rule — team_admin (brokers
// like Peggy/Semonin) and admin-flagged relationship customers skip the modal.
// admin role included as defense-in-depth (Pink Posts staff shouldn't be
// gated by their own customer-facing notice).
export function isPolicyExempt(user: {
  role: string
  isServiceAreaExempt?: boolean | null
}): boolean {
  return (
    user.role === 'team_admin' ||
    user.role === 'admin' ||
    !!user.isServiceAreaExempt
  )
}

// Whether the gate should render the modal for this user right now.
// Returns false for exempt users and for users who've already accepted the
// current notice version.
export function shouldShowPolicyNotice(user: {
  role: string
  isServiceAreaExempt?: boolean | null
  policyNoticeVersion: number
}): boolean {
  if (isPolicyExempt(user)) return false
  return user.policyNoticeVersion < CURRENT_NOTICE_VERSION
}
