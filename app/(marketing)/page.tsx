import { Hero } from '@/components/lander/hero'
import { ScrollTransform } from '@/components/lander/scroll-transform'
import { BiggerSigns } from '@/components/lander/bigger-signs'
import { PostLineup } from '@/components/lander/post-lineup'
import { HowItWorks } from '@/components/lander/how-it-works'
import { AddOns } from '@/components/lander/add-ons'
import { WhyAgents } from '@/components/lander/why-agents'
import { Faq } from '@/components/lander/faq'
import { ClosingCta } from '@/components/lander/closing-cta'
import { MobileOrderBar } from '@/components/lander/mobile-order-bar'

export default function HomePage() {
  return (
    <>
      <Hero />
      <PostLineup />
      <ScrollTransform />
      <BiggerSigns />
      <HowItWorks />
      <AddOns />
      <WhyAgents />
      <Faq />
      <ClosingCta />
      <MobileOrderBar />
      {/* Room for the phone order bar, so it never covers the footer */}
      <div aria-hidden className="h-24 bg-plum md:hidden" />
    </>
  )
}
