'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

const posts = [
  {
    name: 'White Vinyl',
    price: 55,
    image: '/images/posts/white-post.png',
    description: 'Installation & Pickup',
  },
  {
    name: 'Black Vinyl',
    price: 55,
    image: '/images/posts/black-post.png',
    description: 'Installation & Pickup',
  },
  {
    name: 'Signature Pink',
    price: 65,
    image: '/images/posts/pink-post.png',
    description: 'Installation & Pickup',
    featured: true,
  },
]

const PostShowcase = () => {
  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            We install{' '}
            <span className="text-white" style={{ WebkitTextStroke: '1.5px #1f2937' }}>White</span>,{' '}
            <span className="text-gray-900">Black</span>, and{' '}
            <span className="text-pink-500">Pink</span>!
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Choose the perfect post color for your listing
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {posts.map((post, index) => (
            <motion.div
              key={post.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={`relative bg-white rounded-2xl shadow-lg overflow-hidden border-2 ${
                post.featured ? 'border-pink-500' : 'border-gray-100'
              }`}
            >
              {post.featured && (
                <div className="absolute top-0 left-0 right-0 bg-pink-500 text-white text-xs font-semibold py-1.5 text-center z-10">
                  MOST POPULAR
                </div>
              )}

              <div className={`relative h-64 bg-gray-50 ${post.featured ? 'mt-8' : ''}`}>
                <Image
                  src={post.image}
                  alt={post.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover"
                  style={{ objectPosition: 'center 15%' }}
                />
              </div>

              <div className="p-6 text-center">
                <h3 className="text-xl font-bold text-gray-900">{post.name}</h3>
                <div className="mt-3">
                  <span className="text-4xl font-bold text-pink-600">${post.price}</span>
                </div>
                <p className="mt-2 text-gray-600">{post.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center mt-8 text-gray-500 text-sm"
        >
          * Reinstallation is FREE if caused by weather or other natural causes
        </motion.p>
      </div>
    </section>
  )
}

export { PostShowcase }
