import type { Metadata } from 'next'
import Image from 'next/image'
import { PRICING } from '@/components/order-flow/types'
import { PageHeader, FactList } from '@/components/lander/page-header'
import { ClosingCta } from '@/components/lander/closing-cta'
import { MobileOrderBar } from '@/components/lander/mobile-order-bar'

export const metadata: Metadata = {
  title: 'Lockboxes | Pink Posts Installations',
  description: 'We install your Bluetooth or combination lockbox for $5, or rent you one of ours for $10, on the same trip as your post.',
}

const LOCKBOXES = [
  {
    name: 'Your Bluetooth lockbox',
    price: PRICING.lockbox_install,
    priceNote: 'to install',
    image: '/images/lockboxes/lockbox-bluetooth.webp',
    alt: 'A Bluetooth keypad lockbox hanging from a door handle',
    body: 'Bring your SentriLock or other Bluetooth lockbox and we put it on the door.',
    facts: ['Works with the SentriKey app', 'Your lockbox, our install'],
  },
  {
    name: 'Your combination lockbox',
    price: PRICING.lockbox_install,
    priceNote: 'to install',
    image: '/images/lockboxes/lockbox-combination.webp',
    alt: 'A black combination lockbox hanging from a door handle',
    body: 'Already own a combination lockbox? We install it with the post.',
    facts: ['Any combination lockbox', 'Your lockbox, our install'],
  },
  {
    name: 'Rent our lockbox',
    price: PRICING.lockbox_rental,
    priceNote: 'rental and install',
    image: '/images/lockboxes/lockbox-rental.webp',
    alt: 'An open combination lockbox with a house key inside, hanging from a door handle',
    body: "Don't have one? We supply a combination lockbox and install it for you.",
    facts: ['Lockbox provided', 'Comes back to us when the sign comes down'],
    featured: true,
  },
]

const GOOD_TO_KNOW = [
  'Lockboxes go on at the same time as your post.',
  'Rented lockboxes stay ours and come back when the sign comes down.',
  'For SentriLock, you supply the lockbox and use your own SentriKey app.',
]

export default function LockboxesPage() {
  return (
    <>
      <PageHeader
        title="Lockboxes, on the same trip."
        lede="We put your lockbox on the door when we put the post in, or we bring one of ours."
      />

      <section className="bg-white pb-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <ul className="grid gap-6 md:grid-cols-3 md:gap-7">
            {LOCKBOXES.map((box) => (
              <li
                key={box.name}
                className={`flex flex-col rounded-[6px] border-2 bg-white ${
                  box.featured ? 'border-pink-500 shadow-[0_24px_40px_-28px_rgba(199,50,94,0.7)]' : 'border-[#f2d4df]'
                }`}
              >
                <div className="relative -mx-[2px] -mt-[2px] aspect-square overflow-hidden rounded-t-[6px] border-2 border-pink-500">
                  <Image src={box.image} alt={box.alt} fill sizes="(min-width: 768px) 30vw, 100vw" className="object-cover" />
                </div>
                <div className="flex flex-1 flex-col p-5 md:p-6">
                  <p className={`font-display text-[1.9rem] font-extrabold leading-none ${box.featured ? 'text-pink-600' : 'text-plum'}`}>{box.name}</p>
                  <p className="mt-3 leading-relaxed text-plum/75">{box.body}</p>
                  <FactList className="mt-4 text-[0.95rem]" items={box.facts} />
                  <p className="mt-auto pt-5 font-display text-5xl font-black tabular-nums text-pink-600">
                    ${box.price}
                    <span className="ml-2 align-middle font-body text-sm font-semibold text-plum/60">{box.priceNote}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-blush py-[clamp(3.5rem,8vw,6rem)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-8 md:grid-cols-[13rem_1fr] md:gap-10">
          <h2 className="font-display text-[2rem] font-extrabold leading-none text-plum">Good to know</h2>
          <FactList items={GOOD_TO_KNOW} />
        </div>
      </section>

      <ClosingCta />
      <MobileOrderBar />
      {/* Room for the phone order bar, so it never covers the footer */}
      <div aria-hidden className="h-24 bg-plum md:hidden" />
    </>
  )
}
