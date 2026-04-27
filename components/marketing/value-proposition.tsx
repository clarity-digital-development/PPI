'use client'

import { motion, useReducedMotion } from 'framer-motion'
import {
  Zap,
  Package,
  DollarSign,
  Calendar,
  UserCheck,
  FileX,
  Heart,
} from 'lucide-react'

const features = [
  {
    icon: Zap,
    title: 'Next Day Installation',
    description:
      'Orders before 4pm installed next day! We strive for same day installations for an expedite fee if possible.',
  },
  {
    icon: Package,
    title: 'We Store Your Inventory',
    description:
      'Your signs, riders, and lockboxes are safe with us. Access them anytime from your dashboard.',
  },
  {
    icon: DollarSign,
    title: 'One Low Fee',
    description:
      'Includes install AND pickup! When it\'s sold, we pick it up. No surprise charges.',
  },
  {
    icon: Calendar,
    title: 'Easy Online Scheduling',
    description:
      'Book 24/7 from your dashboard. Schedule installations, removals, and service calls anytime.',
  },
  {
    icon: UserCheck,
    title: 'Full Service by Active Broker',
    description:
      'We know what you need! Run by a licensed real estate professional who understands your business.',
  },
  {
    icon: FileX,
    title: 'No Contracts Required',
    description:
      'Pay per order. Cancel anytime. No long-term commitments or hidden fees.',
  },
]

const ValueProposition = () => {
  const shouldReduceMotion = useReducedMotion()

  return (
    <section className="relative py-16 md:py-24 bg-gradient-to-b from-gray-50 to-white overflow-hidden">
      {/* Subtle dot pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.12] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(232, 74, 122, 0.4) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          {/* Fun callout badge */}
          <div className="inline-flex items-center gap-2 rounded-full bg-pink-100 border border-pink-200 px-4 py-1.5 text-sm font-semibold text-pink-700 mb-4">
            <Heart className="w-4 h-4" fill="currentColor" />
            Built by an agent, for agents
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            Why Realtors Choose{' '}
            <span className="text-pink-500">Pink Posts</span>
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            We handle the signs so you can focus on closing deals.
          </p>
        </motion.div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{
                duration: 0.5,
                delay: index * 0.08,
                ease: 'easeOut',
              }}
              whileHover={
                shouldReduceMotion ? undefined : { y: -4, scale: 1.01 }
              }
              className="group relative p-6 rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 hover:ring-pink-200 hover:shadow-xl transition-shadow duration-300"
            >
              {/* Icon with animated gradient background */}
              <div className="relative w-12 h-12 mb-4">
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-xl bg-gradient-to-br from-pink-400 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-md"
                />
                <div className="relative w-12 h-12 rounded-xl bg-pink-100 flex items-center justify-center group-hover:bg-gradient-to-br group-hover:from-pink-500 group-hover:to-pink-600 transition-all duration-300">
                  <feature.icon className="w-6 h-6 text-pink-600 group-hover:text-white transition-colors duration-300" />
                </div>
              </div>

              <h3 className="text-lg font-bold text-gray-900 mb-2 tracking-tight">
                {feature.title}
              </h3>
              <p className="text-gray-600 leading-relaxed text-[15px]">
                {feature.description}
              </p>

              {/* Bottom accent that animates in on hover */}
              <div
                aria-hidden
                className="absolute bottom-0 left-6 right-6 h-0.5 bg-pink-500 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 rounded-full"
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export { ValueProposition }
