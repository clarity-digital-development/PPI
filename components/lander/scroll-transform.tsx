'use client'

import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'framer-motion'
import { useStill } from './use-still'

// The page's scroll moment, as a flat illustration seen from across the
// street, shot like a short film: it opens close on a listing's sagging
// wire-stake sign, pulls back to the whole house as the pink Pink Posts
// Cybertruck drives through the near lane and fills the frame, then pushes
// in on the signature pink post standing where the wire sign was, sparkling.
// The sign is swapped while the truck hides the yard, so it never pops in.
// Everything is tied to scroll, so it plays back in reverse when you scroll up.

const PLUM = '#4a1830'
const GLASS = '#cfe1ec'
const GLOW = '#ffd9a0'

// Truck placement, in scene units. The sign spans x 608-766 with its cap at
// y 620; the truck's roof stays above that whole span while its peak is
// anywhere between x 594 and 841. It drives during TRUCK_RUN, and SWAP puts
// the peak near 718, so the signs trade places while the yard is hidden.
const TRUCK_SCALE = 1.85
const TRUCK_TOP = 892 - 179 * TRUCK_SCALE
const TRUCK_FROM = -1100
const TRUCK_TO = 1650
const TRUCK_RUN = [0.26, 0.7]
const SWAP = 0.462

// ---------------------------------------------------------------------------
// The camera: a viewBox window into the 1600 x 900 scene, always the same
// shape as the screen area so nothing is stretched or cropped by the browser.

type Shot = { x: number; y: number; w: number } // center and width, in scene units

const WIRE_SIGN = { x0: 604, y0: 676, x1: 748, y1: 796 }
const PINK_POST = { x0: 572, y0: 590, x1: 806, y1: 790 }

// Scroll points where the camera starts pulling back from the wire sign, is
// fully wide, starts pushing in on the pink post, and is fully in.
const CAMERA = { outFrom: 0.1, outTo: 0.28, inFrom: 0.7, inTo: 0.84 }

// The whole house, as large as the screen shape allows, standing on the
// bottom edge. Tall phone screens start lower to skip most of the sky.
function wideShot(aspect: number): Shot {
  const top = aspect < 1.2 ? 196 : 140
  const w = Math.min(1600, (900 - top) * aspect)
  return { x: 800, y: 900 - w / aspect / 2, w }
}

function closeOn(box: typeof WIRE_SIGN, pad: number, aspect: number): Shot {
  const w = Math.max((box.x1 - box.x0) * pad, (box.y1 - box.y0) * pad * aspect)
  return { x: (box.x0 + box.x1) / 2, y: Math.min((box.y0 + box.y1) / 2, 900 - w / aspect / 2), w }
}

// Eased move between two shots; the width moves on a log scale so the zoom
// speed feels even.
function between(a: Shot, b: Shot, t: number): Shot {
  const k = Math.min(1, Math.max(0, t))
  const e = k * k * (3 - 2 * k)
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    w: Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * e),
  }
}

function shotAt(v: number, aspect: number): Shot {
  const wide = wideShot(aspect)
  const first = closeOn(WIRE_SIGN, 1.5, aspect)
  const last = closeOn(PINK_POST, 1.15, aspect)
  if (v <= CAMERA.outTo) return between(first, wide, (v - CAMERA.outFrom) / (CAMERA.outTo - CAMERA.outFrom))
  if (v < CAMERA.inFrom) return wide
  return between(wide, last, (v - CAMERA.inFrom) / (CAMERA.inTo - CAMERA.inFrom))
}

// A four-point sparkle centered on (x, y).
function sparklePath(x: number, y: number, r: number) {
  return `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`
}

const SPARKLES = [
  { x: 588, y: 640, r: 15, fill: '#ff4f8b', delay: '0s' },
  { x: 790, y: 672, r: 12, fill: '#ffc23d', delay: '0.5s' },
  { x: 664, y: 604, r: 9, fill: '#ffc23d', delay: '0.9s' },
  { x: 782, y: 742, r: 9, fill: '#ff4f8b', delay: '1.2s' },
  { x: 598, y: 718, r: 8, fill: '#ffc23d', delay: '0.3s' },
  { x: 748, y: 616, r: 7, fill: '#ff4f8b', delay: '1.4s' },
]

// Rotates its children around (cx, cy) with the SVG transform attribute:
// CSS transform-origin on SVG groups put the pivot somewhere else and slid
// the signs out from behind the truck.
function Pivot({ angle, cx, cy, children }: { angle: MotionValue<number>; cx: number; cy: number; children: ReactNode }) {
  const ref = useRef<SVGGElement>(null)
  useMotionValueEvent(angle, 'change', (deg) => {
    ref.current?.setAttribute('transform', `rotate(${deg} ${cx} ${cy})`)
  })
  return (
    <g ref={ref} transform={`rotate(${angle.get()} ${cx} ${cy})`}>
      {children}
    </g>
  )
}

// ---------------------------------------------------------------------------
// The truck

function Wheel({ cx, spin }: { cx: number; spin: MotionValue<number> }) {
  const cy = 134.5
  return (
    <g>
      <circle cx={cx} cy={cy} r={44.5} fill="#1d191b" />
      <circle cx={cx} cy={cy} r={40} fill="none" stroke="#2f292c" strokeWidth="3" />
      <Pivot angle={spin} cx={cx} cy={cy}>
        <circle cx={cx} cy={cy} r={29} fill="#8a8186" />
        <path d={`M${cx} ${cy}L${cx + 27} ${cy - 8}L${cx + 22} ${cy + 17}Z`} fill="#a79ea4" />
        <path
          d={[0, 60, 120, 180, 240, 300]
            .map((a) => {
              const r = (a * Math.PI) / 180
              return `M${cx + 9 * Math.cos(r)} ${cy + 9 * Math.sin(r)}L${cx + 28 * Math.cos(r)} ${cy + 28 * Math.sin(r)}`
            })
            .join('')}
          stroke="#5f575c"
          strokeWidth="3"
        />
        <circle cx={cx} cy={cy} r={9} fill="#4a4347" />
      </Pivot>
    </g>
  )
}

// Angular arch around each wheel: black cladding with the dark well inside.
function Arch({ cx }: { cx: number }) {
  return (
    <>
      <path d={`M${cx - 62} 142L${cx - 55} 92L${cx - 35} 72H${cx + 35}L${cx + 55} 92L${cx + 62} 142Z`} fill="#2b2328" />
      <path d={`M${cx - 52} 142L${cx - 46} 96L${cx - 29} 81H${cx + 29}L${cx + 46} 96L${cx + 52} 142Z`} fill="#120e10" />
    </>
  )
}

// Side profile of the truck, facing right, drawn to its real proportions
// (5.68 m long, 1.79 m tall, 3.81 m wheelbase, 35 in tires; 1 unit = 1 cm).
// One straight line from the low nose up to the roof peak behind the front
// doors, a longer one down to a tail that sits higher than the nose, tall
// angular arches, short overhangs, all wrapped in the company's orchid pink.
function Cybertruck({ spin }: { spin: MotionValue<number> }) {
  const glass = 'M478 59L300 6L196 29L204 59Z'
  return (
    <g>
      <defs>
        <linearGradient id="ct-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8bddc" />
          <stop offset="1" stopColor="#ef9fca" />
        </linearGradient>
        <clipPath id="ct-glass">
          <path d={glass} />
        </clipPath>
      </defs>
      <ellipse cx="284" cy="178" rx="300" ry="7" fill="#2b0a1a" opacity="0.28" />

      <path d="M4 65L300 0L566 79L562 114L548 140H8L0 118Z" fill="url(#ct-body)" />
      <path d="M1 120H559L548 140H8Z" fill="#e897c2" />
      <path d="M4 65L300 0L566 79" fill="none" stroke="#fde0ef" strokeWidth="2.5" strokeLinejoin="bevel" />

      {/* Glass, with the B-pillar splitting it and two soft reflections */}
      <path d={glass} fill="#2b2328" />
      <g clipPath="url(#ct-glass)" fill="#ffffff" opacity="0.12">
        <path d="M420 62L446 62L388 0L362 0Z" />
        <path d="M262 62L274 62L222 0L210 0Z" />
      </g>
      <path d="M326 13L334 16V60H326Z" fill="#f4abd2" />
      <path d="M470 50L487 47L490 56L473 58Z" fill="#2b2328" />

      {/* Door seams */}
      <path d="M330 62V130M200 32V130M482 60L450 76" fill="none" stroke="#dd86b5" strokeWidth="1.6" />

      {/* Lights: the front bar at the nose, the red bar along the tail */}
      <path d="M532 70L566 79L565 84L534 75Z" fill="#fff6fa" />
      <path d="M4 65L40 57L40 61L5 70Z" fill="#e0314f" />

      {/* Rocker, arches, wheels */}
      <path d="M10 130H550L548 142H10Z" fill="#2b2328" />
      <Arch cx={95} />
      <Arch cx={476} />
      <Wheel cx={95} spin={spin} />
      <Wheel cx={476} spin={spin} />

      <text x="312" y="104" textAnchor="middle" fill="#2b0a1a" fontFamily="var(--font-display)" fontWeight="900" fontSize="34" letterSpacing="0.5">
        PINK POSTS
      </text>
      <text x="312" y="119" textAnchor="middle" fill="#2b0a1a" fontFamily="var(--font-body)" fontWeight="700" fontSize="10.5" letterSpacing="2.5">
        INSTALLATION
      </text>
    </g>
  )
}

// ---------------------------------------------------------------------------
// The house

function HouseWindow({ cx, top, w, h, warm, shutters = true }: { cx: number; top: number; w: number; h: number; warm: MotionValue<number>; shutters?: boolean }) {
  const x = cx - w / 2
  const louvers = Array.from({ length: Math.floor((h - 8) / 12) }, (_, i) => top + 8 + i * 12)
  return (
    <g>
      {shutters && (
        <>
          <rect x={x - 26} y={top - 4} width={18} height={h + 8} fill={PLUM} />
          <rect x={x + w + 8} y={top - 4} width={18} height={h + 8} fill={PLUM} />
          <path d={louvers.map((y) => `M${x - 24} ${y}h14M${x + w + 10} ${y}h14`).join('')} stroke="#3a1226" strokeWidth="2" />
        </>
      )}
      <rect x={x - 5} y={top - 5} width={w + 10} height={h + 10} fill="#ffffff" stroke="#ecdde4" strokeWidth="2" />
      <rect x={x} y={top} width={w} height={h} fill={GLASS} />
      <motion.rect x={x} y={top} width={w} height={h} fill={GLOW} style={{ opacity: warm }} />
      <path d={`M${cx} ${top}v${h}M${x} ${top + h / 2}h${w}`} stroke="#ffffff" strokeWidth="5" />
      <rect x={x - 9} y={top + h + 5} width={w + 18} height={7} fill="#ecdde4" />
    </g>
  )
}

// Rows of shingles across a trapezoid roof, eave at y0, ridge at y1.
function shingleRows(left: number, right: number, y0: number, y1: number, inset: number, step: number) {
  const rows: string[] = []
  for (let y = y0 - step; y > y1 + 4; y -= step) {
    const t = (y0 - y) / (y0 - y1)
    rows.push(`M${left + inset * t} ${y}H${right - inset * t}`)
  }
  return rows.join('')
}

function House({ warm, bloom }: { warm: MotionValue<number>; bloom: MotionValue<number> }) {
  const siding = (x0: number, x1: number, y0: number, y1: number) =>
    Array.from({ length: Math.floor((y1 - y0) / 16) }, (_, i) => `M${x0} ${y0 + 16 + i * 16}H${x1}`).join('')

  return (
    <g>
      {/* Trees behind the house */}
      <g fill="#8fc79c">
        <circle cx="470" cy="330" r="84" />
        <circle cx="1185" cy="372" r="92" />
        <circle cx="640" cy="262" r="58" />
      </g>
      <g fill="#7fbf8f">
        <circle cx="400" cy="380" r="62" />
        <circle cx="1250" cy="420" r="66" />
      </g>

      {/* Chimney, then the main hip roof over it */}
      <rect x="980" y="208" width="50" height="100" fill="#6b2340" />
      <rect x="972" y="200" width="66" height="12" fill="#3a1226" />
      <path d="M420 400L560 262H1040L1180 400Z" fill={PLUM} />
      <path d={shingleRows(420, 1180, 400, 262, 140, 22)} stroke="#3f1428" strokeWidth="3" />
      <path d="M560 262H1040" stroke="#3a1226" strokeWidth="6" />

      {/* Wings: a one-story room on the left, the garage on the right */}
      <path d="M168 524L212 456H442V524Z" fill={PLUM} />
      <path d={shingleRows(168, 442, 524, 456, 44, 20)} stroke="#3f1428" strokeWidth="3" />
      <path d="M1158 516L1198 452H1426L1470 516Z" fill={PLUM} />
      <path d={shingleRows(1158, 1470, 516, 452, 42, 20)} stroke="#3f1428" strokeWidth="3" />
      <rect x="182" y="520" width="258" height="202" fill="#ffffff" />
      <rect x="1160" y="512" width="300" height="210" fill="#ffffff" />
      <path d={siding(182, 440, 520, 716) + siding(1160, 1460, 512, 716)} stroke="#f4e8ee" strokeWidth="2" />
      <rect x="166" y="520" width="278" height="9" fill="#ffffff" />
      <rect x="1152" y="510" width="320" height="9" fill="#ffffff" />

      {/* Main two-story block */}
      <rect x="440" y="400" width="720" height="322" fill="#ffffff" />
      <path d={siding(440, 1160, 400, 716)} stroke="#f4e8ee" strokeWidth="2" />
      <rect x="440" y="404" width="720" height="6" fill="#f1e2e9" />
      <rect x="424" y="394" width="752" height="12" fill="#ffffff" />
      <rect x="436" y="400" width="10" height="322" fill="#fbf4f7" />
      <rect x="1154" y="400" width="10" height="322" fill="#fbf4f7" />

      {/* Front gable over the entry */}
      <path d="M800 282L666 406H934Z" fill={PLUM} />
      <path d="M800 306L692 402H908Z" fill="#ffffff" />
      <circle cx="800" cy="364" r="24" fill="#ffffff" stroke="#ecdde4" strokeWidth="3" />
      <circle cx="800" cy="364" r="18" fill={GLASS} />
      <motion.circle cx="800" cy="364" r="18" fill={GLOW} style={{ opacity: warm }} />
      <path d="M800 346v36M782 364h36" stroke="#ffffff" strokeWidth="3" />

      {/* Windows */}
      {[530, 660, 940, 1070].map((cx) => (
        <HouseWindow key={`u${cx}`} cx={cx} top={428} w={70} h={90} warm={warm} />
      ))}
      <HouseWindow cx={800} top={432} w={58} h={76} warm={warm} shutters={false} />
      {[530, 660, 940, 1070].map((cx) => (
        <HouseWindow key={`l${cx}`} cx={cx} top={560} w={78} h={104} warm={warm} />
      ))}
      <HouseWindow cx={262} top={572} w={76} h={92} warm={warm} shutters={false} />
      <HouseWindow cx={364} top={572} w={76} h={92} warm={warm} shutters={false} />

      {/* Flower boxes under the ground-floor windows; they bloom once the
          pink post is in. */}
      <g fill={PLUM}>
        {[530, 660, 940, 1070].map((cx) => (
          <rect key={cx} x={cx - 48} y={680} width={96} height={14} />
        ))}
      </g>
      <motion.g style={{ opacity: bloom }}>
        {[530, 660, 940, 1070].map((cx) => (
          <g key={cx}>
            <g fill="#7fbf8f">
              <ellipse cx={cx - 22} cy={680} rx={22} ry={9} />
              <ellipse cx={cx + 20} cy={680} rx={24} ry={9} />
            </g>
            <g fill="#ff7096">
              <circle cx={cx - 34} cy={674} r={5} />
              <circle cx={cx - 12} cy={671} r={5} />
              <circle cx={cx + 10} cy={674} r={5} />
              <circle cx={cx + 32} cy={672} r={5} />
            </g>
            <g fill="#ffffff">
              <circle cx={cx - 22} cy={676} r={3.5} />
              <circle cx={cx + 22} cy={676} r={3.5} />
            </g>
          </g>
        ))}
      </motion.g>

      {/* Entry: portico, columns, door with sidelights */}
      <path d="M720 574L800 530L880 574Z" fill="#ffffff" stroke={PLUM} strokeWidth="6" strokeLinejoin="round" />
      <rect x="722" y="574" width="156" height="14" fill="#ffffff" />
      <rect x="722" y="586" width="156" height="4" fill="#ecdde4" />
      <rect x="756" y="604" width="12" height="118" fill={GLASS} />
      <rect x="832" y="604" width="12" height="118" fill={GLASS} />
      <motion.g fill={GLOW} style={{ opacity: warm }}>
        <rect x="756" y="604" width="12" height="118" />
        <rect x="832" y="604" width="12" height="118" />
      </motion.g>
      <rect x="772" y="600" width="56" height="122" fill="#9e1748" />
      <g fill="#8a1240">
        <rect x="780" y="610" width="40" height="44" />
        <rect x="780" y="664" width="40" height="50" />
      </g>
      <circle cx="818" cy="664" r="4" fill="#ffd9a0" />
      <rect x="734" y="590" width="14" height="132" fill="#ffffff" />
      <rect x="852" y="590" width="14" height="132" fill="#ffffff" />
      <rect x="742" y="590" width="6" height="132" fill="#f1e2e9" />
      <rect x="860" y="590" width="6" height="132" fill="#f1e2e9" />
      <rect x="722" y="722" width="156" height="8" fill="#eadde3" />
      <rect x="710" y="730" width="180" height="8" fill="#e2d2da" />

      {/* Garage door */}
      <rect x="1206" y="582" width="208" height="140" fill="#f7eef2" stroke="#ecdde4" strokeWidth="4" />
      <path d="M1206 618H1414M1206 652H1414M1206 686H1414" stroke="#e6d6de" strokeWidth="3" />
      <g fill={GLASS}>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={1218 + i * 50} y={592} width={36} height={16} />
        ))}
      </g>
      <circle cx="1310" cy="566" r="6" fill="#ffd9a0" />

      <rect x="166" y="716" width="1306" height="8" fill="#eadde3" />
    </g>
  )
}

// Lawn, walk, driveway, sidewalk and street, then the front trees, bushes
// and mailbox that sit in front of the house.
function Yard() {
  return (
    <g>
      <rect y="722" width="1600" height="50" fill="#bfe3b4" />
      <g fill="#b2dba6">
        <rect y="734" width="1600" height="10" />
        <rect y="754" width="1600" height="10" />
      </g>
      <path d="M764 738H836L872 772H728Z" fill="#efe4e9" />
      <path d="M1206 722H1414L1462 800H1158Z" fill="#e9dfe4" />
      <rect y="772" width="1600" height="20" fill="#f1e7ec" />
      <path d={Array.from({ length: 20 }, (_, i) => `M${i * 84 + 40} 772v20`).join('')} stroke="#e2d5dc" strokeWidth="2" />
      <rect x="1158" y="772" width="304" height="20" fill="#e9dfe4" />
      <rect y="792" width="1600" height="8" fill="#d8c8d0" />
      <rect y="800" width="1600" height="100" fill="#5b4b55" />
      <g fill="#f2e6ec">
        {Array.from({ length: 11 }, (_, i) => (
          <rect key={i} x={i * 160 + 30} y="842" width="84" height="6" />
        ))}
      </g>

      {/* Front trees at both corners */}
      <rect x="166" y="560" width="18" height="176" fill="#5a3a44" />
      <g fill="#7fbf8f">
        <circle cx="175" cy="470" r="96" />
        <circle cx="96" cy="548" r="70" />
        <circle cx="256" cy="552" r="64" />
      </g>
      <g fill="#8fc79c">
        <circle cx="150" cy="440" r="54" />
        <circle cx="226" cy="500" r="40" />
      </g>
      <rect x="1532" y="566" width="18" height="170" fill="#5a3a44" />
      <g fill="#7fbf8f">
        <circle cx="1540" cy="476" r="100" />
        <circle cx="1470" cy="560" r="58" />
        <circle cx="1612" cy="552" r="72" />
      </g>
      <g fill="#8fc79c">
        <circle cx="1512" cy="446" r="54" />
      </g>

      {/* Bushes along the front of the house */}
      <g fill="#7fbf8f">
        <ellipse cx="470" cy="716" rx="42" ry="22" />
        <ellipse cx="620" cy="718" rx="62" ry="24" />
        <ellipse cx="980" cy="718" rx="62" ry="24" />
        <ellipse cx="1120" cy="716" rx="42" ry="22" />
        <ellipse cx="300" cy="720" rx="56" ry="20" />
      </g>
      <g fill="#6fb181">
        <ellipse cx="596" cy="724" rx="32" ry="14" />
        <ellipse cx="1004" cy="724" rx="32" ry="14" />
      </g>

      {/* Mailbox by the driveway */}
      <rect x="1126" y="742" width="8" height="32" fill="#5a3a44" />
      <path d="M1112 726H1148V746H1112Z" fill={PLUM} />
      <path d="M1112 726a18 9 0 0 1 36 0Z" fill={PLUM} />
      <path d="M1146 716V734H1152V722Z" fill="#ff7096" />
    </g>
  )
}

// ---------------------------------------------------------------------------

function Scene({ p, still }: { p: MotionValue<number>; still: boolean }) {
  // Camera: the viewBox follows scroll. Set directly on the element, since
  // it changes every frame.
  const svgRef = useRef<SVGSVGElement>(null)
  const aspect = useRef(1600 / 760)
  const frame = useCallback(
    (v: number) => {
      const svg = svgRef.current
      if (!svg) return
      const shot = still ? wideShot(aspect.current) : shotAt(v, aspect.current)
      const h = shot.w / aspect.current
      svg.setAttribute('viewBox', `${(shot.x - shot.w / 2).toFixed(1)} ${(shot.y - h / 2).toFixed(1)} ${shot.w.toFixed(1)} ${h.toFixed(1)}`)
    },
    [still],
  )
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) aspect.current = width / height
      frame(p.get())
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [frame, p])
  useMotionValueEvent(p, 'change', frame)

  // Truck crosses from off-screen left to off-screen right while the camera
  // is wide.
  const truckX = useTransform(p, TRUCK_RUN, still ? [TRUCK_TO, TRUCK_TO] : [TRUCK_FROM, TRUCK_TO])
  const spin = useTransform(truckX, (x) => ((x / TRUCK_SCALE / (2 * Math.PI * 44.5)) * 360) % 360)
  // Speed lines only while it's actually moving forward.
  const speed = useVelocity(truckX)
  const trail = useTransform(speed, [150, 1100], [0, 0.85])

  // Before: the wire sign sags while we look at it, then leans further as
  // the truck's wind reaches it. At SWAP the truck covers the yard and the
  // signs trade places.
  const before = useTransform(p, (v) => (!still && v < SWAP ? 1 : 0))
  const after = useTransform(before, (v) => 1 - v)
  const lean = useTransform(p, [0, 0.12, 0.3, 0.44], [-3, -6, -6, -13])
  // After: the new sign is still swinging from the wind as it comes back
  // into view behind the truck.
  const swing = useTransform(p, [SWAP, 0.51, 0.56, 0.61, 0.66, 0.72], still ? [0, 0, 0, 0, 0, 0] : [12, -9, 6, -3.5, 1.5, 0])
  const sparkle = useTransform(p, [0.72, 0.8], still ? [1, 1] : [0, 1])
  const bloom = useTransform(p, [0.6, 0.7], still ? [1, 1] : [0, 1])
  const warm = useTransform(p, [0.6, 0.8], still ? [1, 1] : [0, 1])

  return (
    <svg ref={svgRef} viewBox="0 140 1600 760" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      {/* The sky itself is the stage background (SkyBackdrop), so the
          caption band above shares it. */}
      <motion.circle cx="1300" cy="228" r="46" fill="#fff3c8" style={{ opacity: warm }} />
      <g fill="#ffffff">
        <ellipse cx="300" cy="196" rx="74" ry="20" />
        <ellipse cx="338" cy="182" rx="42" ry="22" />
        <ellipse cx="1040" cy="172" rx="66" ry="17" />
        <ellipse cx="1072" cy="160" rx="34" ry="18" />
      </g>

      <House warm={warm} bloom={bloom} />
      <Yard />

      {/* Before: wire-stake sign */}
      <motion.g style={{ opacity: before }}>
        <Pivot angle={lean} cx={676} cy={772}>
          <path d="M650 772V744M702 772V744" stroke="#9aa0a6" strokeWidth="3.5" />
          <rect x="628" y="700" width="96" height="48" fill="#d9443e" />
          <path d="M628 712h96M628 724h96M628 736h96" stroke="#c43a35" strokeWidth="1.5" />
          <text x="676" y="732" textAnchor="middle" fill="#ffffff" fontFamily="var(--font-display)" fontWeight="900" fontSize="21">
            FOR SALE
          </text>
        </Pivot>
      </motion.g>

      {/* After: the signature pink post */}
      <motion.g style={{ opacity: after }}>
        <rect x="620" y="628" width="12" height="144" fill="#e84a7a" />
        <rect x="632" y="628" width="7" height="144" fill="#c23562" />
        <path d="M618 628H641L637 620H622Z" fill="#f58fae" />
        <rect x="608" y="640" width="152" height="12" fill="#e84a7a" />
        <rect x="608" y="640" width="152" height="3" fill="#f58fae" />
        <path d="M760 640L765 646L760 652Z" fill="#c23562" />
        <Pivot angle={swing} cx={708} cy={652}>
          <path d="M672 652v11M744 652v11" stroke="#9aa0a6" strokeWidth="2.5" />
          <rect x="656" y="662" width="104" height="56" fill="#ffffff" />
          <rect x="660" y="666" width="96" height="48" fill="none" stroke="#e84a7a" strokeWidth="2.5" />
          <text x="708" y="698" textAnchor="middle" fill="#2b0a1a" fontFamily="var(--font-display)" fontWeight="900" fontSize="22">
            FOR SALE
          </text>
        </Pivot>
      </motion.g>
      <motion.g style={{ opacity: sparkle }}>
        {SPARKLES.map((spark) => (
          <path
            key={`${spark.x}-${spark.y}`}
            d={sparklePath(spark.x, spark.y, spark.r)}
            fill={spark.fill}
            className="pp-twinkle"
            style={{ animationDelay: spark.delay }}
          />
        ))}
      </motion.g>

      {/* The truck, in the near lane, between us and the yard */}
      <motion.g style={{ x: truckX }}>
        <g transform={`translate(0 ${TRUCK_TOP}) scale(${TRUCK_SCALE})`}>
          <motion.path
            d="M-30 46H-150M-18 92H-196M-34 130H-124"
            stroke="#ffffff"
            strokeWidth="5"
            strokeLinecap="round"
            style={{ opacity: trail }}
          />
          <Cybertruck spin={spin} />
        </g>
      </motion.g>
    </svg>
  )
}

// Sky behind the whole stage, warming to golden-pink once the post is in.
function SkyBackdrop({ p, still }: { p: MotionValue<number>; still: boolean }) {
  const warm = useTransform(p, [0.6, 0.8], still ? [0.55, 0.55] : [0, 0.55])
  return (
    <>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#ffe0ea_0%,#fff6f9_70%)]" />
      <motion.div className="absolute inset-0 bg-[linear-gradient(180deg,#ff86a9_0%,#ffd3b8_70%)]" style={{ opacity: warm }} />
    </>
  )
}

const HEADING = 'font-display text-[clamp(2.1rem,4.2vw,3.6rem)] font-extrabold leading-[0.9] text-plum'
const BODY = 'mt-3 text-base sm:text-lg text-plum/80 md:mt-0'

export function ScrollTransform() {
  const still = useStill()
  const trackRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })
  // One caption per shot: the wire sign, the truck pass, the pink post.
  const firstCaption = useTransform(scrollYProgress, [0, 0.14, 0.2], [1, 1, 0])
  const middleCaption = useTransform(scrollYProgress, [0.22, 0.29, 0.62, 0.69], [0, 1, 1, 0])
  const lastCaption = useTransform(scrollYProgress, [0.76, 0.84, 1], [0, 1, 1])

  if (still) {
    return (
      <section ref={trackRef} className="relative flex h-[85svh] min-h-[560px] flex-col overflow-hidden" aria-label="A premium post, installed">
        <SkyBackdrop p={scrollYProgress} still />
        <div className="relative mx-auto w-full max-w-6xl px-4 pt-12 sm:px-8 md:grid md:grid-cols-[1fr_minmax(0,24rem)] md:items-end md:gap-10">
          <p className={HEADING}>Yours gets a premium post.</p>
          <p className={BODY}>Set straight, kept up, and picked up when it sells. If a storm knocks it down, we put it back free.</p>
        </div>
        <div className="relative mt-6 flex-1">
          <Scene p={scrollYProgress} still />
        </div>
      </section>
    )
  }

  return (
    <section ref={trackRef} className="relative h-[340svh]" aria-label="A wire-stake sign swapped for a premium post">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden">
        <SkyBackdrop p={scrollYProgress} still={false} />

        {/* Captions sit in their own band above the scene, so the house can
            fill the frame below them. */}
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-3 pt-[calc(5rem+1.25rem)] sm:px-8 md:pt-[calc(5rem+1.75rem)]">
          <div className="relative min-h-[9.5rem] md:min-h-[6.5rem]">
            <motion.div style={{ opacity: firstCaption }} className="absolute inset-x-0 top-0 md:grid md:grid-cols-[1fr_minmax(0,24rem)] md:items-end md:gap-10">
              <p className={HEADING}>Most listings get a wire stake.</p>
              <p className={BODY}>It leans, it fades, and the first storm takes it down.</p>
            </motion.div>
            <motion.div style={{ opacity: middleCaption }} className="absolute inset-x-0 top-0 md:grid md:grid-cols-[1fr_minmax(0,24rem)] md:items-end md:gap-10">
              <p className={HEADING}>Then we pull up.</p>
              <p className={BODY}>Order by 4pm and we&apos;re out the next day to put your post in.</p>
            </motion.div>
            <motion.div style={{ opacity: lastCaption }} className="absolute inset-x-0 top-0 md:grid md:grid-cols-[1fr_minmax(0,24rem)] md:items-end md:gap-10">
              <p className={HEADING}>Yours gets a premium post.</p>
              <p className={BODY}>Set straight, kept up, and picked up when it sells. If a storm knocks it down, we put it back free.</p>
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
