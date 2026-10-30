'use client'

import { useEffect, useRef } from 'react'
import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion'
import { useStill } from './use-still'

// "Bigger signs. More attention. More calls. More deals." as four running
// banners in the sign lettering, stacked like ribbons. Each is bigger and
// deeper in color than the one above, ending on the deal in pink. They drift
// on their own, speed up with your scroll, and run backwards when you scroll
// back up. Nothing pins the page.

type Band = {
  text: string
  size: string
  colors: string // band background and lettering
  outline: string // stroke color for the outlined repeats
  spark: string
  tilt: number
  speed: number // px per second; the sign sets the direction
}

const BANDS: Band[] = [
  {
    text: 'Bigger signs',
    size: 'text-[clamp(2rem,5vw,4rem)]',
    colors: 'bg-white text-plum',
    outline: '#2b0a1a',
    spark: '#e84a7a',
    tilt: -2,
    speed: 45,
  },
  {
    text: 'More attention',
    size: 'text-[clamp(2.7rem,7.2vw,5.8rem)]',
    colors: 'bg-pink-200 text-raspberry',
    outline: '#9e1748',
    spark: '#e84a7a',
    tilt: 1.4,
    speed: -60,
  },
  {
    text: 'More calls',
    size: 'text-[clamp(3.5rem,10vw,8.2rem)]',
    colors: 'bg-plum text-white',
    outline: '#ffffff',
    spark: '#ffc23d',
    tilt: -1.6,
    speed: 80,
  },
  {
    text: 'More deals',
    size: 'text-[clamp(4.6rem,14.5vw,12rem)]',
    colors: 'bg-pink-600 text-white',
    outline: '#ffffff',
    spark: '#ffc23d',
    tilt: 1.8,
    speed: -105,
  },
]

const COPIES = 4 // identical copies, so moving one copy's width looks like no move at all
const REPEATS = 4 // phrases per copy, enough to outrun a wide screen

const wrap = (min: number, max: number, v: number) => {
  const range = max - min
  return ((((v - min) % range) + range) % range) + min
}

function Sparkle({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" className="mx-[0.35em] inline-block h-[0.5em] w-[0.5em] shrink-0 align-middle" aria-hidden>
      <path d="M10 0Q10 10 20 10Q10 10 10 20Q10 10 0 10Q10 10 10 0Z" fill={color} />
    </svg>
  )
}

function RunningBand({ band, index }: { band: Band; index: number }) {
  const still = useStill()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '200px 0px' })

  // Scroll speed adds to the drift; scrolling up flips the direction.
  const { scrollY } = useScroll()
  const scrollVelocity = useVelocity(scrollY)
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 })
  const boost = useTransform(smoothVelocity, [0, 1000], [0, 4], { clamp: false })
  const direction = useRef(1)

  const baseX = useMotionValue(-index * 7)
  const x = useTransform(baseX, (v) => `${wrap(-50, -25, v)}%`)

  // Speeds are in px, the track moves in % of its own width.
  const track = useRef<HTMLDivElement>(null)
  const trackWidth = useRef(4000)
  useEffect(() => {
    const el = track.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth > 0) trackWidth.current = el.offsetWidth
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useAnimationFrame((_, delta) => {
    if (still || !inView) return
    const b = boost.get()
    if (b < 0) direction.current = -1
    else if (b > 0) direction.current = 1
    const step = direction.current * ((band.speed * (delta / 1000)) / trackWidth.current) * 100
    baseX.set(baseX.get() + step + step * Math.abs(b))
  })

  return (
    <div
      ref={ref}
      aria-hidden
      className={`relative -mx-[6vw] overflow-hidden py-[0.1em] shadow-[0_0.25em_0.6em_-0.3em_rgba(43,10,26,0.35)] ${band.colors} ${band.size}`}
      style={{ rotate: `${band.tilt}deg` }}
    >
      <motion.div ref={track} style={{ x }} className="flex w-max whitespace-nowrap font-display font-black uppercase leading-[0.95] tracking-[-0.005em]">
        {Array.from({ length: COPIES }, (_, c) => (
          <span key={c} className="flex items-center">
            {Array.from({ length: REPEATS }, (_, r) => (
              <span key={r} className="flex items-center">
                <span
                  className={r % 2 ? 'text-transparent' : undefined}
                  style={r % 2 ? { WebkitTextStroke: `0.03em ${band.outline}` } : undefined}
                >
                  {band.text}
                </span>
                <Sparkle color={band.spark} />
              </span>
            ))}
          </span>
        ))}
      </motion.div>
    </div>
  )
}

export function BiggerSigns() {
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(180deg,#fff7fa_0%,#ffe9f1_100%)] py-[clamp(3.5rem,8vw,6.5rem)]">
      <h2 className="sr-only">Bigger signs. More attention. More calls. More deals.</h2>
      <div className="flex flex-col gap-[clamp(0.35rem,1vw,0.75rem)]">
        {BANDS.map((band, i) => (
          <RunningBand key={band.text} band={band} index={i} />
        ))}
      </div>
    </section>
  )
}
