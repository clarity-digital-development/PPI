'use client'

import { useRef } from 'react'
import Image from 'next/image'
import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useStill } from './use-still'

// Riders and lockboxes. Riders hook on under a sign one at a time as the
// stack scrolls up the screen, ending with Coming Soon. The page never stops
// scrolling for it; scroll back up and they come off again. Lockboxes show
// as photos on the same pink door, priced the way they're ordered.

const RIDER_PRICES = [
  { item: 'Rent one of our riders', note: 'Coming Soon, Pending, bedroom counts, and 20+ more', price: '$5' },
  { item: 'We install your rider', note: 'Name riders, or anything else you have', price: '$2' },
]

const RIDERS = ['4 Beds', 'Pool/Spa', 'Huge Backyard', 'Coming Soon']

const LOCKBOXES = [
  {
    name: 'Your Bluetooth lockbox',
    note: 'SentriLock or any Bluetooth box. We put it on the door.',
    price: '$5',
    image: '/images/lockboxes/lockbox-bluetooth.webp',
    alt: 'A Bluetooth keypad lockbox hanging from a door handle',
  },
  {
    name: 'Your combination lockbox',
    note: 'Bring your own and we install it with the post.',
    price: '$5',
    image: '/images/lockboxes/lockbox-combination.webp',
    alt: 'A black combination lockbox hanging from a door handle',
  },
  {
    name: 'Rent our lockbox',
    note: 'We supply the combination lockbox and install it.',
    price: '$10',
    image: '/images/lockboxes/lockbox-rental.webp',
    alt: 'An open combination lockbox with a house key inside, hanging from a door handle',
  },
]

// One rider: it drops onto the hooks of the one above during its slice of
// the scroll, with a small swing as it lands.
function Rider({ label, index, count, p, last }: { label: string; index: number; count: number; p: MotionValue<number>; last: boolean }) {
  const start = index / count
  const land = start + 0.6 / count
  const settle = start + 0.95 / count
  const y = useTransform(p, [start, land], [-44, 0])
  const opacity = useTransform(p, [start, start + 0.2 / count], [0, 1])
  const rotate = useTransform(p, [start, land, start + 0.78 / count, settle], [-9, 5, -2, 0])

  return (
    <motion.div style={{ y, opacity, rotate, transformOrigin: '50% 0%' }} className="mx-auto w-[86%]">
      <div className="flex justify-between px-[16%]" aria-hidden>
        <span className="block h-3.5 w-[3px] bg-[#9aa0a6]" />
        <span className="block h-3.5 w-[3px] bg-[#9aa0a6]" />
      </div>
      <div
        className={`rounded-[3px] py-2 text-center font-display text-xl font-extrabold uppercase tracking-wide shadow-[0_12px_20px_-16px_rgba(107,24,49,0.7)] ${
          last ? 'bg-raspberry text-white' : 'bg-pink-600 text-white'
        }`}
      >
        {label}
      </div>
    </motion.div>
  )
}

function RiderStack() {
  const still = useStill()
  const ref = useRef<HTMLDivElement>(null)
  // 0 when the stack's top comes up past the bottom of the screen, 1 once
  // its bottom reaches a little above the middle.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.92', 'end 0.6'] })
  const done = useMotionValue(1)
  const p = still ? done : scrollYProgress

  return (
    <div ref={ref} className="relative w-full max-w-sm" role="img" aria-label={`A for-sale sign with ${RIDERS.length} riders hanging under it: ${RIDERS.join(', ')}`}>
      <div className="rounded-[4px] border-[3px] border-pink-500 bg-white px-5 py-4 text-center font-display text-4xl font-black text-plum shadow-[0_18px_30px_-22px_rgba(107,24,49,0.6)]">
        FOR SALE
      </div>
      {RIDERS.map((rider, i) => (
        <Rider key={rider} label={rider} index={i} count={RIDERS.length} p={p} last={i === RIDERS.length - 1} />
      ))}
    </div>
  )
}

export function AddOns() {
  return (
    <section className="bg-blush py-[clamp(4.5rem,11vw,9rem)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="grid gap-12 md:grid-cols-[1.1fr_0.9fr] md:items-center md:gap-16">
          <div>
            <h2 className="font-display text-[clamp(2.6rem,6.4vw,5.25rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-plum">
              Riders and lockboxes, on the same trip.
            </h2>
            <dl className="mt-8 divide-y-2 divide-white md:mt-10">
              {RIDER_PRICES.map((row) => (
                <div key={row.item} className="flex items-baseline gap-4 py-5">
                  <div className="min-w-0 flex-1">
                    <dt className="font-display text-2xl font-extrabold text-plum sm:text-[1.7rem]">{row.item}</dt>
                    <p className="mt-1 text-[0.95rem] text-plum/70">{row.note}</p>
                  </div>
                  <dd className="font-display text-4xl font-black tabular-nums text-pink-600">{row.price}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex justify-center md:justify-end">
            <RiderStack />
          </div>
        </div>

        <ul className="mt-16 grid gap-4 md:mt-24 md:grid-cols-3 md:gap-7">
          {LOCKBOXES.map((box) => (
            <li key={box.name} className="grid grid-cols-[7.5rem_1fr] rounded-[6px] border-2 border-[#f2d4df] bg-white md:grid-cols-1">
              {/* The photo fills its side of the card edge to edge, framed in
                  a darker pink that sits over the card's own border. */}
              <div className="relative -my-[2px] -ml-[2px] min-h-[7.5rem] overflow-hidden rounded-l-[6px] border-2 border-pink-500 md:-mx-[2px] md:-mt-[2px] md:mb-0 md:aspect-square md:rounded-l-none md:rounded-t-[6px]">
                <Image src={box.image} alt={box.alt} fill sizes="(min-width: 768px) 30vw, 7.5rem" className="object-cover" />
              </div>
              <div className="flex items-start gap-3 p-4 md:p-5">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[1.45rem] font-extrabold leading-none text-plum md:text-[1.6rem]">{box.name}</p>
                  <p className="mt-2 text-[0.92rem] leading-snug text-plum/70">{box.note}</p>
                </div>
                <p className="font-display text-3xl font-black leading-none tabular-nums text-pink-600">{box.price}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
