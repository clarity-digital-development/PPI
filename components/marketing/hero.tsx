'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { CheckCircle, Zap, Package, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui'

const keyPoints = [
  { icon: Zap, text: 'Next Day Installation' },
  { icon: DollarSign, text: 'One Low Fee — includes install AND pickup' },
  { icon: Package, text: 'We Store Your Inventory' },
]

const Hero = () => {
  return (
    <section className="relative overflow-hidden gradient-pink-subtle grain-overlay">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 lg:py-32">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center lg:text-left"
          >
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">
              We take care of the dirty work,{' '}
              <span className="text-pink-500">so you can focus on closing more deals!</span>
            </h1>
            <p className="mt-6 text-xl md:text-2xl text-pink-600 font-semibold">
              Stay clean... and warm!
            </p>
            <p className="mt-4 text-lg text-gray-600 max-w-xl mx-auto lg:mx-0">
              Premium yard sign installation service for real estate professionals
              in Lexington, Louisville, Cincinnati, and surrounding areas.
            </p>

            {/* CTA Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Link href="/sign-up" className="inline-block">
                <Button size="lg" className="w-full sm:w-auto min-h-[48px]">
                  Get Started
                  <svg
                    className="ml-2 w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 8l4 4m0 0l-4 4m4-4H3"
                    />
                  </svg>
                </Button>
              </Link>
              <Link href="/sign-in">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">
                  Sign In
                </Button>
              </Link>
            </div>

            {/* Key Points */}
            <div className="mt-10 space-y-3">
              {keyPoints.map((point, index) => (
                <motion.div
                  key={point.text}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
                  className="flex items-center gap-3 justify-center lg:justify-start"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-pink-500" />
                  </div>
                  <span className="text-gray-700 font-medium">{point.text}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Hero Image */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <div className="relative aspect-[3/4] max-w-md mx-auto rounded-2xl shadow-xl overflow-hidden">
              <Image
                src="/images/posts/pink-post.png"
                alt="Pink Post Installation"
                fill
                sizes="(max-width: 768px) 100vw, 400px"
                className="object-cover"
                style={{ objectPosition: 'center 15%' }}
                priority
              />
            </div>

            {/* Decorative Elements */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-pink-200 rounded-full blur-2xl opacity-60" />
            <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-pink-100 rounded-full blur-2xl opacity-60" />
          </motion.div>
        </div>
      </div>
    </section>
  )
}

export { Hero }
