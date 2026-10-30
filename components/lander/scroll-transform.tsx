'use client'

import { useRef } from 'react'
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'

// The page's scroll moment, as a flat illustration: a listing with a sagging
// wire-stake sign, then the pink Pink Posts Cybertruck drives by and leaves
// the signature pink post in its place. Everything is tied to scroll, so it
// plays back in reverse when you scroll up.

const ORIGIN_BOTTOM = { transformBox: 'fill-box', transformOrigin: '50% 100%' } as const
const ORIGIN_TOP = { transformBox: 'fill-box', transformOrigin: '50% 0%' } as const
const ORIGIN_CENTER = { transformBox: 'fill-box', transformOrigin: '50% 50%' } as const

// Spun with the SVG transform attribute around the hub's own center: CSS
// transform-origin on a nested, already-translated group put one hub off
// the truck.
function Wheel({ cx, spin }: { cx: number; spin: MotionValue<number> }) {
  const hub = useRef<SVGGElement>(null)
  useMotionValueEvent(spin, 'change', (deg) => {
    hub.current?.setAttribute('transform', `rotate(${deg % 360} ${cx} 122)`)
  })
  return (
    <g>
      <circle cx={cx} cy={122} r={31} fill="#1f1a1d" />
      <g ref={hub}>
        <circle cx={cx} cy={122} r={15} fill="#5a4f55" />
        <path d={`M${cx - 15} 122h30M${cx} 107v30`} stroke="#1f1a1d" strokeWidth="4" />
      </g>
    </g>
  )
}

// The truck, facing right. Wedge profile, dark glass, black cladding and
// angular wheel arches, wrapped in the company's orchid pink.
function Cybertruck({ spin }: { spin: MotionValue<number> }) {
  return (
    <g>
      <ellipse cx={220} cy={154} rx={210} ry={9} fill="#2b0a1a" opacity="0.18" />
      <path d="M0 112 L6 58 L252 4 L440 60 L436 112 Z" fill="#f2a5cf" />
      <path d="M6 58 L252 4 L440 60 L437 66 L252 12 L8 64 Z" fill="#f8c4e0" />
      <path d="M118 46 L252 16 L368 48 Z" fill="#2b2328" />
      <path d="M0 104 H436 V118 H0 Z" fill="#2b2328" />
      <path d="M52 120 L66 86 L126 86 L140 120 Z" fill="#2b2328" />
      <path d="M302 120 L316 86 L376 86 L390 120 Z" fill="#2b2328" />
      <rect x="424" y="57" width="16" height="5" fill="#fff6fa" />
      <text x="214" y="88" textAnchor="middle" fill="#2b0a1a" fontFamily="var(--font-display)" fontWeight="900" fontSize="34" letterSpacing="0.5">PINK POSTS</text>
      <text x="214" y="101" textAnchor="middle" fill="#2b0a1a" fontFamily="var(--font-body)" fontWeight="700" fontSize="11" letterSpacing="2">INSTALLATION</text>
      <Wheel cx={96} spin={spin} />
      <Wheel cx={346} spin={spin} />
    </g>
  )
}

function Scene({ p, still }: { p: MotionValue<number>; still: boolean }) {
  // Truck crosses from off-screen left to off-screen right.
  const truckX = useTransform(p, [0.1, 0.9], still ? [640, 640] : [-480, 1240])
  const spin = useTransform(truckX, (x) => (x / (2 * Math.PI * 31)) * 360)
  // It reaches the yard around 0.44: the wire sign pops, the pink post grows,
  // its sign swings in, and the yard warms up.
  const wireScale = useTransform(p, [0.4, 0.46], still ? [0, 0] : [1, 0])
  const wireTilt = useTransform(p, [0.4, 0.46], [-5, -30])
  const postGrow = useTransform(p, [0.44, 0.54], still ? [1, 1] : [0, 1])
  const swing = useTransform(p, [0.52, 0.58, 0.63, 0.68], still ? [0, 0, 0, 0] : [-14, 7, -3, 0])
  const sparkle = useTransform(p, [0.44, 0.5, 0.6], still ? [0, 0, 0] : [0, 1, 0])
  const bloom = useTransform(p, [0.54, 0.66], still ? [1, 1] : [0, 1])
  const warm = useTransform(p, [0.5, 0.8], still ? [1, 1] : [0, 1])

  return (
    <svg viewBox="0 0 1200 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden>
      {/* The sky itself is the stage background (SkyBackdrop), so the
          caption band on phones shares it. */}
      <motion.circle cx="930" cy="200" r="64" fill="#fff3c8" style={{ opacity: warm }} />
      <g fill="#ffffff">
        <ellipse cx="210" cy="150" rx="70" ry="22" />
        <ellipse cx="250" cy="134" rx="44" ry="26" />
        <ellipse cx="760" cy="96" rx="80" ry="20" />
        <ellipse cx="800" cy="82" rx="40" ry="22" />
      </g>

      {/* Trees behind the house */}
      <g fill="#8fc79c">
        <circle cx="330" cy="470" r="70" />
        <circle cx="285" cy="505" r="52" />
        <circle cx="880" cy="460" r="78" />
        <circle cx="935" cy="505" r="54" />
      </g>

      {/* House */}
      <rect x="420" y="330" width="360" height="232" fill="#ffffff" />
      <rect x="742" y="330" width="38" height="232" fill="#f5e6ec" />
      <rect x="704" y="210" width="34" height="90" fill="#3a1226" />
      <polygon points="392,338 600,186 808,338" fill="#4a1830" />
      <circle cx="600" cy="278" r="22" fill="#cfe1ec" />
      <g fill="#cfe1ec">
        <rect x="455" y="362" width="70" height="72" />
        <rect x="675" y="362" width="70" height="72" />
        <rect x="455" y="470" width="70" height="72" />
        <rect x="675" y="470" width="70" height="72" />
      </g>
      <motion.g fill="#ffd9a0" style={{ opacity: warm }}>
        <circle cx="600" cy="278" r="22" />
        <rect x="455" y="362" width="70" height="72" />
        <rect x="675" y="362" width="70" height="72" />
        <rect x="455" y="470" width="70" height="72" />
        <rect x="675" y="470" width="70" height="72" />
      </motion.g>
      <g stroke="#ffffff" strokeWidth="5">
        <path d="M490 362v72M455 398h70M710 362v72M675 398h70M490 470v72M455 506h70M710 470v72M675 506h70" />
      </g>
      <rect x="568" y="448" width="64" height="114" fill="#9e1748" />
      <circle cx="620" cy="508" r="4" fill="#ffd9a0" />
      <rect x="552" y="560" width="96" height="10" fill="#eadde3" />

      {/* Lawn, walk, sidewalk, street */}
      <rect y="566" width="1200" height="178" fill="#bfe3b4" />
      <g fill="#b2dba6">
        <rect y="604" width="1200" height="22" />
        <rect y="664" width="1200" height="22" />
        <rect y="724" width="1200" height="20" />
      </g>
      <polygon points="574,568 626,568 668,744 532,744" fill="#efe4e9" />
      <g fill="#7fbf8f">
        <ellipse cx="482" cy="566" rx="62" ry="32" />
        <ellipse cx="722" cy="566" rx="62" ry="32" />
      </g>
      <motion.g style={{ scale: bloom, ...ORIGIN_CENTER }}>
        <g fill="#ff7096">
          <circle cx="452" cy="556" r="7" /><circle cx="480" cy="546" r="7" /><circle cx="510" cy="560" r="7" />
          <circle cx="700" cy="552" r="7" /><circle cx="732" cy="546" r="7" /><circle cx="756" cy="562" r="7" />
        </g>
        <g fill="#ffffff">
          <circle cx="466" cy="566" r="5" /><circle cx="496" cy="570" r="5" />
          <circle cx="716" cy="568" r="5" /><circle cx="744" cy="572" r="5" />
        </g>
      </motion.g>
      <rect y="744" width="1200" height="24" fill="#f1e7ec" />
      <rect y="768" width="1200" height="8" fill="#d8c8d0" />
      <rect y="776" width="1200" height="124" fill="#5b4b55" />
      <g fill="#f2e6ec">
        {Array.from({ length: 11 }, (_, i) => (
          <rect key={i} x={i * 120 + 20} y="836" width="62" height="6" />
        ))}
      </g>

      {/* Before: wire-stake sign */}
      <motion.g style={{ scaleY: wireScale, rotate: wireTilt, ...ORIGIN_BOTTOM }}>
        <path d="M412 742V690M462 742V690" stroke="#9aa0a6" strokeWidth="4" />
        <rect x="392" y="636" width="90" height="58" fill="#d9443e" />
        <g stroke="#c43a35" strokeWidth="1.5">
          <path d="M392 648h90M392 660h90M392 672h90M392 684h90" />
        </g>
        <text x="437" y="672" textAnchor="middle" fill="#ffffff" fontFamily="var(--font-display)" fontWeight="900" fontSize="22">FOR SALE</text>
      </motion.g>

      {/* After: the signature pink post */}
      <motion.g style={{ scaleY: postGrow, ...ORIGIN_BOTTOM }}>
        <rect x="386" y="570" width="26" height="174" fill="#e84a7a" />
        <rect x="400" y="570" width="12" height="174" fill="#c23562" />
        <polygon points="388,570 410,570 412,564 386,564" fill="#f58fae" />
        <rect x="376" y="584" width="178" height="20" fill="#e84a7a" />
        <rect x="376" y="584" width="178" height="5" fill="#f58fae" />
        <polygon points="554,584 560,592 554,604" fill="#c23562" />
        <motion.g style={{ rotate: swing, ...ORIGIN_TOP }}>
          <path d="M440 604v14M522 604v14" stroke="#9aa0a6" strokeWidth="3" />
          <rect x="420" y="616" width="122" height="74" fill="#ffffff" />
          <rect x="425" y="621" width="112" height="64" fill="none" stroke="#e84a7a" strokeWidth="3" />
          <text x="481" y="663" textAnchor="middle" fill="#2b0a1a" fontFamily="var(--font-display)" fontWeight="900" fontSize="27">FOR SALE</text>
        </motion.g>
      </motion.g>
      <motion.g fill="#ffffff" style={{ opacity: sparkle }}>
        <path d="M360 610l5 14 14 5-14 5-5 14-5-14-14-5 14-5z" />
        <path d="M576 636l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" />
        <path d="M402 548l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
      </motion.g>

      {/* The truck, on the near lane */}
      <motion.g style={{ x: truckX, y: 738 }}>
        <Cybertruck spin={spin} />
      </motion.g>
    </svg>
  )
}

// Sky behind the whole stage, warming to golden-pink once the post is in.
function SkyBackdrop({ p, still }: { p: MotionValue<number>; still: boolean }) {
  const warm = useTransform(p, [0.5, 0.8], still ? [0.55, 0.55] : [0, 0.55])
  return (
    <>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#ffe0ea_0%,#fff6f9_70%)]" />
      <motion.div className="absolute inset-0 bg-[linear-gradient(180deg,#ff86a9_0%,#ffd3b8_70%)]" style={{ opacity: warm }} />
    </>
  )
}

export function ScrollTransform() {
  const still = useReducedMotion() ?? false
  const trackRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })
  const firstCaption = useTransform(scrollYProgress, [0, 0.06, 0.3, 0.38], [0, 1, 1, 0])
  const secondCaption = useTransform(scrollYProgress, [0.6, 0.7, 1], [0, 1, 1])

  if (still) {
    return (
      <section className="relative h-[80svh] min-h-[520px] overflow-hidden" aria-label="The pink post, installed">
        <SkyBackdrop p={scrollYProgress} still />
        <Scene p={scrollYProgress} still />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-8 pt-16 md:flex md:justify-end">
          <p className="max-w-md font-display text-[clamp(2.2rem,5vw,4rem)] font-extrabold leading-[0.9] text-plum">
            Yours gets the pink post.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section ref={trackRef} className="relative h-[300svh]" aria-label="A wire-stake sign swapped for the pink post">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden">
        <SkyBackdrop p={scrollYProgress} still={false} />

        {/* Captions: their own band above the scene on phones, in the open
            sky to the right of the house on wider screens. */}
        <div className="relative z-10 mx-auto w-full max-w-6xl md:max-w-[90rem] px-4 sm:px-8 pt-[calc(5rem+1.25rem)] md:absolute md:inset-x-0 md:top-0 md:flex md:justify-end md:pt-[calc(5rem+clamp(1.5rem,5vh,3.5rem))]">
          <div className="relative min-h-[9.5rem] md:min-h-0 md:w-[22rem] lg:w-[24rem]">
          <motion.div style={{ opacity: firstCaption }} className="absolute inset-x-0 top-0">
            <p className="font-display text-[clamp(2.1rem,4.2vw,3.6rem)] font-extrabold leading-[0.9] text-plum">
              Most listings get a wire stake.
            </p>
            <p className="mt-3 text-base sm:text-lg text-plum/80">It leans, it fades, and the first storm takes it down.</p>
          </motion.div>
          <motion.div style={{ opacity: secondCaption }} className="absolute inset-x-0 top-0">
            <p className="font-display text-[clamp(2.1rem,4.2vw,3.6rem)] font-extrabold leading-[0.9] text-plum">
              Yours gets the pink post.
            </p>
            <p className="mt-3 text-base sm:text-lg text-plum/80">
              Set straight, kept up, and picked up when it sells. If a storm knocks it down, we put it back free.
            </p>
          </motion.div>
          </div>
        </div>

        {/* On phones the scene ends above the sticky order bar */}
        <div className="relative mb-[5.5rem] flex-1 md:mb-0">
          <Scene p={scrollYProgress} still={false} />
        </div>
      </div>
    </section>
  )
}
