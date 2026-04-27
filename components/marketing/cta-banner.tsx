'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui'

const CTABanner = () => {
  const shouldReduceMotion = useReducedMotion()

  return (
    <section className="relative py-20 md:py-28 overflow-hidden bg-pink-600">
      {/* Animated gradient background */}
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-pink-500 via-pink-600 to-pink-700"
        animate={
          shouldReduceMotion
            ? undefined
            : {
                backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
              }
        }
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 12, repeat: Infinity, ease: 'easeInOut' }
        }
        style={{ backgroundSize: '200% 200%' }}
      />

      {/* Soft floating blobs */}
      <motion.div
        aria-hidden
        className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-pink-300/30 blur-3xl"
        animate={shouldReduceMotion ? undefined : { y: [0, 20, 0], x: [0, 15, 0] }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : {
                duration: 8,
                repeat: Infinity,
                ease: 'easeInOut',
                repeatType: 'reverse',
              }
        }
      />
      <motion.div
        aria-hidden
        className="absolute -bottom-20 -right-10 w-96 h-96 rounded-full bg-pink-400/30 blur-3xl"
        animate={shouldReduceMotion ? undefined : { y: [0, -20, 0], x: [0, -15, 0] }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : {
                duration: 10,
                repeat: Infinity,
                ease: 'easeInOut',
                repeatType: 'reverse',
                delay: 1,
              }
        }
      />

      {/* Subtle dot pattern overlay */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255, 255, 255, 0.4) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight text-balance">
            Ready to Simplify Your Sign Installations?
          </h2>
          <p className="mt-5 text-lg md:text-xl text-pink-100 max-w-2xl mx-auto">
            Next-day sign installation so you can focus on closing deals.
          </p>

          <div className="mt-10 flex justify-center">
            <Link href="/sign-up" className="inline-flex">
              <motion.div
                whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                whileTap={shouldReduceMotion ? undefined : { y: 0, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <Button
                  size="lg"
                  className="group bg-white text-pink-600 hover:bg-pink-50 shadow-2xl min-h-[48px] px-10 text-base font-bold"
                >
                  Create Free Account
                  <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                </Button>
              </motion.div>
            </Link>
          </div>

          <p className="mt-5 text-sm text-pink-100/90">
            Start scheduling today. Cancel anytime.
          </p>
        </motion.div>
      </div>
    </section>
  )
}

export { CTABanner }
