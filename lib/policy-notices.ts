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
        'Orders outside our service area carry an out of area fee covering both the install and the pickup. Each city we service has a free radius measured in road miles — actual driving distance. Once a property is outside that radius, the fee is $25 per trip covering the first 20 extra miles, then $2 per mile beyond that. The reason for this is we pay our employees hourly, and a property an hour out incurs two hours for the installation and two more for the pickup, which is a loss for the company on a single sign. We still want to accommodate agents with those further out properties as much as possible. Your exact amount and the mileage behind it are shown on the review page before you pay. Thank you for your understanding and any additional questions, please let us know!',
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

// WHY: mirrors the service-area exemption rule for the MODAL only — brokers
// and admin-flagged relationship customers skip it. Note this is deliberately
// broader than lib/service-area.ts's fee exemption, which as of 2026-09-19 is
// the isServiceAreaExempt flag alone: brokers now pay out-of-area fees but
// still don't get the consumer-facing policy modal.
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
