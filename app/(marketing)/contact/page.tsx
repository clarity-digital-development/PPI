'use client'

import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui'
import { Phone, Mail, MapPin, Clock } from 'lucide-react'

export default function ContactPage() {
  return (
    <div className="py-12 md:py-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900">
            Contact Us
          </h1>
          <p className="mt-4 text-lg text-gray-600">
            We&apos;re here to help with all your sign installation needs.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="grid md:grid-cols-2 gap-6"
        >
          {/* Contact Information */}
          <Card variant="bordered">
            <CardContent className="p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                Get in Touch
              </h2>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Phone</h3>
                    <a
                      href="tel:859-395-8188"
                      className="text-pink-600 hover:text-pink-700 font-medium"
                    >
                      859-395-8188
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Email</h3>
                    <a
                      href="mailto:Contact@PinkPosts.com"
                      className="text-pink-600 hover:text-pink-700 font-medium"
                    >
                      Contact@PinkPosts.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Location</h3>
                    <p className="text-gray-600">
                      110 Winding View Trail<br />
                      Georgetown, KY 40324
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Hours */}
          <Card variant="bordered">
            <CardContent className="p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                Business Hours
              </h2>
              <div className="flex items-start gap-4 mb-6">
                <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-pink-600" />
                </div>
                <div className="flex-1">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Monday - Friday</span>
                      <span className="font-medium text-gray-900">Open</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Saturday - Sunday</span>
                      <span className="font-medium text-gray-900">Closed</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-pink-50 rounded-lg">
                <p className="text-sm text-gray-700">
                  <strong>Next Day Installation:</strong> Orders placed before 4pm EST
                  receive next business day installation.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Service Area */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-6"
        >
          <Card variant="bordered">
            <CardContent className="p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                Service Area
              </h2>
              <p className="text-gray-600 mb-6">
                We proudly serve real estate professionals throughout Central Kentucky and Greater Cincinnati.
              </p>

              {/* Kentucky */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-pink-500 rounded-full"></span>
                  Kentucky
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    'Fayette County',
                    'Scott County',
                    'Woodford County',
                    'Jessamine County',
                    'Clark County',
                    'Madison County',
                    'Bourbon County',
                    'Franklin County',
                  ].map((county) => (
                    <div
                      key={county}
                      className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 text-center"
                    >
                      {county}
                    </div>
                  ))}
                </div>
              </div>

              {/* Ohio */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-pink-500 rounded-full"></span>
                  Ohio (Greater Cincinnati)
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    'Hamilton County',
                    'Butler County',
                    'Warren County',
                    'Clermont County',
                  ].map((county) => (
                    <div
                      key={county}
                      className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 text-center"
                    >
                      {county}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
