'use client'

import Image from 'next/image'
import Link from 'next/link'
import { MotionConfig, motion } from 'framer-motion'

const EASE = [0.16, 1, 0.3, 1] as const

// One of the two eye-screw-and-ring hooks the sign hangs from.
function Hook() {
  return (
    <svg width="16" height="30" viewBox="0 0 16 30" aria-hidden className="block">
      <path d="M8 0v7" stroke="#8d97a1" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="8" cy="14" r="6" fill="none" stroke="#b9c1c9" strokeWidth="2.5" />
      <path d="M8 20v10" stroke="#8d97a1" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// The hero is the product: a signature pink post, built like the real one
// (cap, arm near the top, sign on two hooks), planted in front of the company
// name. On wide screens the name sits under the sign; on portrait screens it
// moves to the top and stands on the arm, with the post running up beside it
// and the sign hanging below. The post rises, the arm reaches out, and the
// sign drops onto its hooks and settles. That's the page's one load-time moment; reduced-motion
// visitors get the still scene (MotionConfig skips the movement for them,
// and the server and browser render the same markup either way).
export function Hero() {
  return (
    <MotionConfig reducedMotion="user">
      <section className="hero-dome lander-grain relative isolate overflow-hidden">
        <div className="relative mx-auto flex min-h-[calc(100svh-5rem)] max-w-[90rem] flex-col [--top:clamp(1rem,4vw,2rem)] [--post-x:6%] sm:[--post-x:14%] lg:[--post-x:25%] [--post-w:clamp(34px,4.8vw,74px)] [--arm-h:clamp(26px,3.5vw,54px)]">
          {/* Post: in front of the lettering, down to the ground */}
          <motion.div
            aria-hidden
            className="absolute z-30 top-[clamp(1.25rem,3vw,2.25rem)] portrait:top-[var(--top)] bottom-0 left-[var(--post-x)] w-[var(--post-w)] flex flex-col"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            transition={{ duration: 0.9, ease: EASE }}
          >
            <div className="pp-cap shrink-0" />
            <div className="pp-post flex-1" />
          </motion.div>

          <div className="relative z-20 pt-[calc(clamp(1.25rem,3vw,2.25rem)+var(--post-w)*0.24+var(--post-w)*0.45)] portrait:pt-0">
            {/* Arm: a stub's width left of the post, reaching right */}
            <motion.div
              aria-hidden
              className="pp-arm h-[var(--arm-h)] ml-[calc(var(--post-x)-var(--post-w)*0.85)] mr-[3%] sm:mr-[9%] lg:mr-[16%]"
              style={{ originX: 0 }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.55, duration: 0.6, ease: EASE }}
            />

            {/* Sign, hanging from two hooks under the arm */}
            <motion.div
              className="ml-[calc(var(--post-x)+var(--post-w)+0.75rem)] mr-[5%] sm:mr-[12%] lg:ml-[calc(var(--post-x)+var(--post-w)+5rem)] lg:mr-auto lg:max-w-[38rem]"
              style={{ transformOrigin: '50% 0%' }}
              initial={{ opacity: 0, y: -36, rotate: -7 }}
              animate={{ opacity: 1, y: 0, rotate: [-7, 4, -2, 0.8, 0] }}
              transition={{
                delay: 1,
                opacity: { delay: 1, duration: 0.25 },
                y: { delay: 1, duration: 0.45, ease: EASE },
                rotate: { delay: 1, duration: 1.7, ease: 'easeOut', times: [0, 0.3, 0.6, 0.82, 1] },
              }}
            >
              <div className="flex justify-between px-[16%]">
                <Hook />
                <Hook />
              </div>
              <div className="hero-sign rounded-[6px] bg-white p-1.5 shadow-[0_34px_60px_-28px_rgba(107,24,49,0.55),0_4px_10px_rgba(43,10,26,0.08)]">
                <div className="rounded-[3px] border-2 border-pink-500 px-4 py-5 sm:px-9 sm:py-8 portrait:py-[clamp(1.25rem,3.2svh,2.25rem)]">
                  <p className="font-display font-extrabold text-plum text-[clamp(1.8rem,3.9vw,3.4rem)] portrait:text-[clamp(1.8rem,4.6svh,3.2rem)] leading-[0.98] tracking-[-0.01em] text-balance">
                    We do the dirty work, so you can close{' '}
                    <span className="whitespace-nowrap text-pink-600">more deals</span>.
                  </p>
                  <p className="mt-3 text-[0.95rem] leading-relaxed text-plum/80 text-balance sm:mt-4 sm:text-lg portrait:text-[clamp(0.95rem,2.2svh,1.2rem)]">
                    Yard sign posts from $59, installed and picked up for you.
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-6 sm:flex sm:gap-3">
                    <Link href="/sign-up" className="ring-btn">
                      <span className="bg-pink-600 text-white">Get started</span>
                    </Link>
                    <Link href="/sign-in" className="ring-btn">
                      <span className="bg-white text-raspberry">Sign in</span>
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* The company name, lined up with the sign's left edge so the post
              never cuts through it. Wide screens: under the sign, taking
              whatever height the sign leaves so the hero fits above the fold.
              Portrait screens: first, with Installations standing on the arm,
              drawn over it so the letters sit on its top face. */}
          <motion.h1
            className="hero-wordmark relative z-10 mt-auto pt-[clamp(1.5rem,3vw,2.5rem)] portrait:order-first portrait:z-[25] portrait:mt-0 portrait:pt-[var(--top)] pr-[4%] pl-[calc(var(--post-x)+var(--post-w)+0.75rem)] lg:pl-[calc(var(--post-x)+var(--post-w)+5rem)] font-display font-black uppercase leading-[0.84] tracking-[-0.01em] text-raspberry"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7, ease: EASE }}
          >
            <span className="hero-mark-1 block whitespace-nowrap">Pink Post</span>
            <span className="hero-mark-2 block whitespace-nowrap pb-[0.08em] portrait:pb-0">Installations</span>
          </motion.h1>

          {/* Portrait screens: the roadrunner from the logo pops up from the
              bottom right once the sign has settled. It sits behind the sign,
              is sized to the room left under it, and fades out at the bottom
              like the post's foot. */}
          <motion.div
            aria-hidden
            className="hero-bird pointer-events-none absolute bottom-0 right-[5%] z-10 hidden h-[clamp(84px,calc(100svh-540px),220px)] portrait:block"
            initial={{ y: '105%' }}
            animate={{ y: 0 }}
            transition={{ delay: 2.1, type: 'spring', stiffness: 260, damping: 18 }}
          >
            <Image src="/images/lander/roadrunner-wave.webp" alt="" width={640} height={591} sizes="240px" className="h-full w-auto" />
          </motion.div>
        </div>
      </section>
    </MotionConfig>
  )
}
