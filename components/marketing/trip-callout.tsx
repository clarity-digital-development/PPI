'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Sparkles, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui'

const TripCallout = () => {
  return (
    <section className="py-12 bg-gradient-to-r from-pink-500 to-pink-600">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left"
        >
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-bold text-white">
                Want us to hang that SOLD sign?
              </h3>
              <p className="text-pink-100">We can do that for you!</p>
            </div>
          </div>

          <Link href="/sign-up">
            <Button
              variant="secondary"
              size="lg"
              className="bg-white text-pink-600 hover:bg-gray-100"
            >
              Sign Up to Get Started
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  )
}

export { TripCallout }
