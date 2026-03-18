'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui'

const CTABanner = () => {
  return (
    <section className="py-16 md:py-24 bg-pink-600">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Ready to Simplify Your Sign Installations?
          </h2>
          <p className="mt-4 text-lg text-pink-100 max-w-2xl mx-auto">
            Next-day sign installation so you can focus on closing deals
          </p>
          <div className="mt-8">
            <Link href="/sign-up">
              <Button
                size="lg"
                className="bg-white text-pink-600 hover:bg-pink-50 shadow-lg min-h-[48px]"
              >
                Create Free Account
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-pink-200">
            No credit card required. Start scheduling today.
          </p>
        </motion.div>
      </div>
    </section>
  )
}

export { CTABanner }
