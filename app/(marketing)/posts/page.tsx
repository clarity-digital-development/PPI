'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { Card, CardContent, Button } from '@/components/ui'
import Link from 'next/link'

const posts = [
  {
    name: 'White PVC Post',
    slug: 'white',
    description:
      'Our classic white PVC post offers timeless elegance that complements any property style. Durable, weather-resistant, and maintenance-free.',
    installationFee: 59,
    image: '/images/posts/white-post.png',
    badge: 'Premium Vinyl',
    features: [
      'Premium PVC construction',
      '6\' height standard',
      'Weather-resistant finish',
      'Includes hardware',
    ],
  },
  {
    name: 'Black PVC Post',
    slug: 'black',
    description:
      'Modern sophistication with a sleek black finish. Perfect for upscale listings and agents who want a contemporary look.',
    installationFee: 59,
    image: '/images/posts/black-post.png',
    badge: 'Premium Vinyl',
    features: [
      'Premium PVC construction',
      '6\' height standard',
      'UV-resistant black finish',
      'Includes hardware',
    ],
  },
  {
    name: 'Pink Signature Post',
    slug: 'pink',
    description:
      'Stand out from the crowd with our signature pink post. A bold statement that gets noticed and remembered.',
    installationFee: 65,
    image: '/images/posts/pink-post.png',
    featured: true,
    badge: 'Premium Vinyl',
    features: [
      'Premium PVC construction',
      '6\' height standard',
      'Signature pink finish',
      'Includes hardware',
      'Exclusive design',
    ],
  },
  {
    name: 'Metal Frame Sign',
    slug: 'metal-frame',
    description:
      'A budget-friendly option for standard real estate signage. Sturdy angle iron construction with a powder coated finish, designed to hold 18"h x 24"w signs.',
    installationFee: 40,
    image: '/images/posts/metal-frame.jpg',
    badge: 'Standard',
    features: [
      'Angle iron construction',
      'Powder coated finish',
      'Fits 18"h x 24"w signs',
      'Includes installation & pickup',
    ],
  },
]

export default function PostsPage() {
  return (
    <div className="py-12 md:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900">
            Post Options
          </h1>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Choose the perfect post for your property signage. All posts include
            professional installation and removal.
          </p>
        </motion.div>

        {/* Posts */}
        <div className="space-y-12">
          {posts.map((post, index) => (
            <motion.div
              key={post.slug}
              id={post.slug}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card
                variant="bordered"
                className={`overflow-hidden ${
                  post.featured ? 'ring-2 ring-pink-500' : ''
                }`}
              >
                <div className="grid md:grid-cols-2">
                  {/* Image */}
                  <div className="relative h-80 md:h-auto min-h-[320px] bg-gray-50">
                    <Image
                      src={post.image}
                      alt={post.name}
                      fill
                      className="object-cover object-top"
                    />
                  </div>

                  {/* Content */}
                  <CardContent className="p-8">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-2xl font-bold text-gray-900">
                        {post.name}
                      </h2>
                      {post.featured && (
                        <span className="bg-pink-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                          POPULAR
                        </span>
                      )}
                      {post.badge && (
                        <span className="bg-gray-100 text-gray-600 text-xs font-semibold px-3 py-1 rounded-full">
                          {post.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-4 text-gray-600">{post.description}</p>

                    {/* Features */}
                    <ul className="mt-6 space-y-2">
                      {post.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-center gap-2 text-sm text-gray-600"
                        >
                          <svg
                            className="w-4 h-4 text-pink-500 flex-shrink-0"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                          {feature}
                        </li>
                      ))}
                    </ul>

                    {/* Pricing Table */}
                    <div className="mt-8 border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full">
                        <tbody>
                          <tr>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              Installation Fee
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                              ${post.installationFee}.00
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <Link href="/sign-up">
                      <Button
                        variant={post.featured ? 'primary' : 'outline'}
                        className="w-full mt-6"
                        size="lg"
                      >
                        Select This Post
                      </Button>
                    </Link>
                  </CardContent>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
