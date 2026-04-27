'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'
import { Zap, Sparkles, ArrowRight, MapPin, Clock, Heart } from 'lucide-react'
import { Button } from '@/components/ui'

const socialProof = [
  { icon: Clock, label: 'Next-day install' },
  { icon: MapPin, label: 'KY & OH coverage' },
  { icon: Heart, label: 'Loved by agents' },
]

const Hero = () => {
  const shouldReduceMotion = useReducedMotion()

  // Floating decorative dots — disabled if user prefers reduced motion
  const floatTransition = (delay: number) =>
    shouldReduceMotion
      ? { duration: 0 }
      : {
          duration: 6,
          delay,
          repeat: Infinity,
          repeatType: 'reverse' as const,
          ease: 'easeInOut' as const,
        }

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-pink-50 via-white to-pink-100 grain-overlay min-h-[calc(100svh-5rem)] lg:min-h-0 flex items-center">
      {/* Subtle dot grid background */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(232, 74, 122, 0.35) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage:
            'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at center, black 40%, transparent 75%)',
        }}
      />

      {/* Floating gradient blobs */}
      <motion.div
        aria-hidden
        className="absolute top-10 -left-20 w-72 h-72 rounded-full bg-pink-200/50 blur-3xl"
        animate={shouldReduceMotion ? undefined : { y: [0, 30, 0], x: [0, 10, 0] }}
        transition={floatTransition(0)}
      />
      <motion.div
        aria-hidden
        className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-pink-300/30 blur-3xl"
        animate={shouldReduceMotion ? undefined : { y: [0, -25, 0], x: [0, -15, 0] }}
        transition={floatTransition(1.5)}
      />

      <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-24 lg:py-28">
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
          {/* Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center lg:text-left"
          >
            <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-gray-900 leading-[1.05] tracking-tight text-balance">
              We do the dirty work,{' '}
              <span className="text-pink-500">so you can close more deals.</span>
            </h1>

            <p className="mt-6 text-xl md:text-2xl text-pink-600 font-semibold tracking-tight">
              Stay clean... and warm!
            </p>
            <p className="mt-4 text-base md:text-lg text-gray-600 max-w-xl mx-auto lg:mx-0">
              Premium yard sign installation for real estate professionals across
              Kentucky and Cincinnati. Book online, we handle the rest.
            </p>

            {/* CTA Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center lg:justify-start">
              <Link href="/sign-up" className="inline-flex">
                <motion.div
                  whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                  whileTap={shouldReduceMotion ? undefined : { y: 0, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                  className="w-full sm:w-auto"
                >
                  <Button
                    size="lg"
                    className="group w-full sm:w-auto min-h-[48px] shadow-lg hover:shadow-pink"
                  >
                    Get Started
                    <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>
                </motion.div>
              </Link>
              <Link href="/sign-in">
                <motion.div
                  whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                  whileTap={shouldReduceMotion ? undefined : { y: 0, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                  className="w-full sm:w-auto"
                >
                  <Button variant="outline" size="lg" className="w-full sm:w-auto min-h-[48px]">
                    Sign In
                  </Button>
                </motion.div>
              </Link>
            </div>

            {/* Social proof strip */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mt-8 flex flex-wrap gap-x-5 gap-y-2 justify-center lg:justify-start text-sm text-gray-600"
            >
              {socialProof.map((item) => (
                <div key={item.label} className="inline-flex items-center gap-1.5">
                  <item.icon className="w-4 h-4 text-pink-500" />
                  <span className="font-medium">{item.label}</span>
                </div>
              ))}
            </motion.div>

          </motion.div>

          {/* Hero Image — desktop only; takes too much space on mobile */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
            className="relative hidden lg:block"
          >
            {/* Soft glow behind */}
            <div
              aria-hidden
              className="absolute inset-0 m-auto w-3/4 h-3/4 rounded-full bg-pink-300/40 blur-3xl"
            />

            <motion.div
              animate={shouldReduceMotion ? undefined : { y: [0, -8, 0] }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 5, repeat: Infinity, ease: 'easeInOut' }
              }
              className="relative aspect-[3/4] max-w-md mx-auto rounded-3xl shadow-2xl overflow-hidden ring-1 ring-pink-200/50"
            >
              <Image
                src="/images/posts/pink-post.png"
                alt="Pink Posts Installations signature pink yard sign"
                fill
                sizes="(max-width: 768px) 90vw, 480px"
                className="object-cover"
                style={{ objectPosition: 'center 15%' }}
                priority
              />
            </motion.div>

            {/* Floating glass-morphism stat card */}
            <motion.div
              initial={{ opacity: 0, y: 20, x: -10 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              transition={{ duration: 0.6, delay: 0.7 }}
              className="absolute -bottom-4 -left-2 sm:-left-6 max-w-[200px] backdrop-blur-md bg-white/75 rounded-2xl p-4 shadow-xl ring-1 ring-pink-200/60"
            >
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center text-white">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="text-2xl font-bold text-gray-900 leading-none tracking-tight">100+</div>
                  <div className="text-xs text-gray-600 font-medium">installs &amp; counting</div>
                </div>
              </div>
            </motion.div>

            {/* Floating "next-day" pill */}
            <motion.div
              initial={{ opacity: 0, y: -10, x: 10 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              transition={{ duration: 0.6, delay: 0.9 }}
              className="absolute top-4 -right-2 sm:-right-4 backdrop-blur-md bg-pink-500/95 text-white rounded-full px-4 py-2 shadow-xl text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Zap className="w-4 h-4" fill="currentColor" />
              Next-day install
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

export { Hero }
