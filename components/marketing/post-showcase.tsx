'use client'

import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'
import { Star } from 'lucide-react'

const posts = [
  {
    name: 'White Vinyl',
    price: 55,
    image: '/images/posts/white-post.png',
    description: 'Installation & Pickup',
    accent: 'from-gray-100 to-white',
    headerText: 'Classic',
  },
  {
    name: 'Black Vinyl',
    price: 55,
    image: '/images/posts/black-post.png',
    description: 'Installation & Pickup',
    accent: 'from-gray-100 to-white',
    headerText: 'Sleek',
  },
  {
    name: 'Signature Pink',
    price: 65,
    image: '/images/posts/pink-post.png',
    description: 'Installation & Pickup',
    accent: 'from-pink-100 to-pink-50',
    headerText: 'Most Popular',
    featured: true,
  },
]

const PostShowcase = () => {
  const shouldReduceMotion = useReducedMotion()

  return (
    <section className="relative py-16 md:py-24 bg-white overflow-hidden">
      {/* Subtle accent in background */}
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-pink-50/60 blur-3xl pointer-events-none"
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="inline-block text-xs font-semibold tracking-[0.2em] uppercase text-pink-600 mb-3">
            Pick your post
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            We install{' '}
            <span className="text-white" style={{ WebkitTextStroke: '1.5px #1f2937' }}>White</span>,{' '}
            <span className="text-gray-900">Black</span>, and{' '}
            <span className="text-pink-500">Pink</span>!
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Choose the perfect post color for your listing.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {posts.map((post, index) => (
            <motion.div
              key={post.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={
                shouldReduceMotion ? undefined : { y: -8, scale: 1.015 }
              }
              className={`group relative bg-white rounded-3xl shadow-md overflow-hidden border-2 transition-shadow duration-300 hover:shadow-2xl ${
                post.featured
                  ? 'border-pink-500 hover:shadow-pink-200/60'
                  : 'border-gray-100 hover:border-pink-200'
              }`}
            >
              {/* Featured ribbon */}
              {post.featured && (
                <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-pink-500 to-pink-600 text-white text-xs font-bold tracking-wider py-2 text-center z-10 inline-flex items-center justify-center gap-1.5">
                  <Star className="w-3.5 h-3.5" fill="currentColor" />
                  MOST POPULAR
                  <Star className="w-3.5 h-3.5" fill="currentColor" />
                </div>
              )}

              {/* Image area with soft gradient backdrop */}
              <div
                className={`relative h-64 bg-gradient-to-br ${post.accent} ${
                  post.featured ? 'mt-9' : ''
                }`}
              >
                <Image
                  src={post.image}
                  alt={post.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  style={{ objectPosition: 'center 15%' }}
                />
              </div>

              {/* Content */}
              <div className="p-6 text-center">
                <span
                  className={`inline-block text-[11px] font-semibold tracking-[0.15em] uppercase mb-2 ${
                    post.featured ? 'text-pink-600' : 'text-gray-400'
                  }`}
                >
                  {post.headerText}
                </span>
                <h3 className="text-xl font-bold text-gray-900 tracking-tight">
                  {post.name}
                </h3>
                <div className="mt-4 flex items-baseline justify-center gap-1">
                  <span className="text-sm font-semibold text-gray-400">$</span>
                  <span className="text-5xl font-extrabold text-pink-600 tracking-tight leading-none">
                    {post.price}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600 font-medium">
                  {post.description}
                </p>
              </div>

              {/* Bottom accent bar that grows on hover */}
              <div
                aria-hidden
                className={`absolute bottom-0 left-0 right-0 h-1 origin-left transition-transform duration-500 group-hover:scale-x-100 ${
                  post.featured
                    ? 'bg-pink-500 scale-x-100'
                    : 'bg-pink-500 scale-x-0'
                }`}
              />
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center mt-10 text-gray-500 text-sm"
        >
          * Reinstallation is FREE if caused by weather or other natural causes
        </motion.p>
      </div>
    </section>
  )
}

export { PostShowcase }
