'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { Button, Card, CardContent } from '@/components/ui'

const posts = [
  {
    name: 'White PVC',
    slug: 'white',
    description: 'Classic elegance that complements any property style.',
    price: 59,
    image: '/images/posts/white-post.png',
  },
  {
    name: 'Black PVC',
    slug: 'black',
    description: 'Modern sophistication with a sleek finish.',
    price: 59,
    image: '/images/posts/black-post.png',
  },
  {
    name: 'Pink Signature',
    slug: 'pink',
    description: 'Stand out from the crowd with our signature pink.',
    price: 65,
    image: '/images/posts/pink-post.png',
    featured: true,
  },
]

const PostPreview = () => {
  return (
    <section id="pricing" className="py-16 md:py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            Our Post Options
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Choose the perfect post to showcase your listings.
          </p>
        </motion.div>

        {/* Posts Grid */}
        <div className="grid md:grid-cols-3 gap-8">
          {posts.map((post, index) => (
            <motion.div
              key={post.slug}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card
                variant="interactive"
                className={`relative overflow-hidden ${
                  post.featured ? 'ring-2 ring-pink-500' : ''
                }`}
              >
                {post.featured && (
                  <div className="absolute top-4 right-4 bg-pink-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    POPULAR
                  </div>
                )}
                <CardContent className="p-0">
                  {/* Post Visual */}
                  <div className="relative h-64 bg-gray-50">
                    <Image
                      src={post.image}
                      alt={post.name}
                      fill
                      className="object-cover object-top"
                    />
                  </div>

                  {/* Post Info */}
                  <div className="p-6">
                    <h3 className="text-xl font-semibold text-gray-900">
                      {post.name}
                    </h3>
                    <p className="mt-2 text-gray-600 text-sm">
                      {post.description}
                    </p>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-gray-900">
                        ${post.price}
                      </span>
                      <span className="text-gray-500 text-sm">installation</span>
                    </div>
                    <Link href={`/posts#${post.slug}`}>
                      <Button
                        variant={post.featured ? 'primary' : 'outline'}
                        className="w-full mt-4"
                      >
                        View Details
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export { PostPreview }
