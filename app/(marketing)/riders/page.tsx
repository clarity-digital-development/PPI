import type { Metadata } from 'next'
import { RIDERS, RIDER_CATEGORIES } from '@/components/order-flow/RiderSelector/constants'
import { PRICING } from '@/components/order-flow/types'
import { PageHeader, FactList } from '@/components/lander/page-header'
import { ClosingCta } from '@/components/lander/closing-cta'
import { MobileOrderBar } from '@/components/lander/mobile-order-bar'

export const metadata: Metadata = {
  title: 'Riders | Pink Posts Installations',
  description: 'Rent any of our riders for $5, or we hang yours for $2. Status, bedrooms, features, and custom number riders.',
}

// Every rider an agent can order, straight from the order form's list, so a
// new rider shows up here on its own. Each category gets its own plate
// color; the custom ones take a number.
const PLATE: Record<string, string> = {
  status: 'bg-pink-600 text-white',
  bedrooms: 'bg-raspberry text-white',
  property_features: 'bg-plum text-white',
  rental_lease: 'bg-pink-600 text-white',
  special: 'bg-raspberry text-white',
  custom: 'border-2 border-dashed border-pink-500 bg-white text-pink-600',
}

const CATEGORIES = RIDER_CATEGORIES.filter((c) => c.id !== 'popular')

const TERMS = [
  'Riders go up with your post, or within 24 hours.',
  'Rented riders stay ours and come back when the sign comes down.',
  'Need something we don\'t have? Ask about a custom rider (extra fees apply).',
]

function Rider({ name, plate, custom }: { name: string; plate: string; custom?: boolean }) {
  return (
    <li className="group">
      {/* Hangs from two hooks and swings a little when pointed at */}
      <div className="origin-top transition-transform duration-500 [transition-timing-function:cubic-bezier(.3,1.6,.5,1)] group-hover:rotate-[-3deg] motion-reduce:transition-none motion-reduce:group-hover:rotate-0">
        <div className="flex justify-between px-[22%]" aria-hidden>
          <span className="block h-3 w-[3px] bg-[#9aa0a6]" />
          <span className="block h-3 w-[3px] bg-[#9aa0a6]" />
        </div>
        <div className={`rounded-[3px] px-4 py-2 text-center font-display text-xl font-extrabold uppercase tracking-wide shadow-[0_12px_20px_-16px_rgba(107,24,49,0.7)] ${plate}`}>
          {custom ? (
            <>
              <span className="mr-1 rounded-[2px] bg-pink-100 px-1.5 text-pink-600">#</span>
              {name.replace(/^Custom /, '')}
            </>
          ) : (
            name
          )}
        </div>
      </div>
    </li>
  )
}

export default function RidersPage() {
  return (
    <>
      <PageHeader
        title="Riders that say it for you."
        lede={
          <>
            Rent any of ours for ${PRICING.rider_rental}, or we hang your own for ${PRICING.rider_install}. They go up on the same trip as
            your post.
          </>
        }
      >
        <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <dt className="text-sm font-semibold text-plum/70">Rent ours</dt>
            <dd className="font-display text-5xl font-black tabular-nums text-pink-600">${PRICING.rider_rental}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-plum/70">Hang yours</dt>
            <dd className="font-display text-5xl font-black tabular-nums text-pink-600">${PRICING.rider_install}</dd>
          </div>
        </dl>
      </PageHeader>

      <section className="bg-white pb-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto max-w-6xl space-y-14 px-4 sm:px-8">
          {CATEGORIES.map((category) => {
            const riders = RIDERS.filter((r) => r.category === category.id)
            if (!riders.length) return null
            return (
              <div key={category.id} className="grid gap-5 md:grid-cols-[13rem_1fr] md:gap-10">
                <h2 className="font-display text-[2rem] font-extrabold leading-none text-plum">
                  {category.id === 'custom' ? 'With your number' : category.label}
                </h2>
                <ul className="flex flex-wrap gap-x-4 gap-y-3">
                  {riders.map((rider) => (
                    <Rider key={rider.id} name={rider.name} plate={PLATE[category.id] ?? PLATE.status} custom={category.id === 'custom'} />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      <section className="bg-blush py-[clamp(3.5rem,8vw,6rem)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-8 md:grid-cols-[13rem_1fr] md:gap-10">
          <h2 className="font-display text-[2rem] font-extrabold leading-none text-plum">Good to know</h2>
          <FactList items={TERMS} />
        </div>
      </section>

      <ClosingCta />
      <MobileOrderBar />
      {/* Room for the phone order bar, so it never covers the footer */}
      <div aria-hidden className="h-24 bg-plum md:hidden" />
    </>
  )
}
