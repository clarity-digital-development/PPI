import type { Metadata } from 'next'
import { PageHeader } from '@/components/lander/page-header'
import { FaqList, QUESTIONS, MORE_QUESTIONS, CallUs } from '@/components/lander/faq'
import { ClosingCta } from '@/components/lander/closing-cta'
import { MobileOrderBar } from '@/components/lander/mobile-order-bar'

export const metadata: Metadata = {
  title: 'FAQ | Pink Posts Installations',
  description: 'How fast we install, where we serve, what happens if a post is damaged, using your own signs, and how payment works.',
}

export default function FaqPage() {
  return (
    <>
      <PageHeader title="Questions agents ask." lede={<CallUs />} />

      <section className="bg-white pb-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto max-w-4xl px-4 sm:px-8">
          <FaqList items={[...QUESTIONS, ...MORE_QUESTIONS]} />
        </div>
      </section>

      <ClosingCta />
      <MobileOrderBar />
      {/* Room for the phone order bar, so it never covers the footer */}
      <div aria-hidden className="h-24 bg-plum md:hidden" />
    </>
  )
}
