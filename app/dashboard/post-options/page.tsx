'use client'

import { Header, PostCard } from '@/components/dashboard'

const posts = [
  {
    name: 'White PVC Post',
    slug: 'white',
    description:
      'Our classic white PVC post offers timeless elegance that complements any property style. Durable, weather-resistant, and maintenance-free.',
    installationFee: 59,
    imageUrl: '/images/posts/white-post.png',
  },
  {
    name: 'Black PVC Post',
    slug: 'black',
    description:
      'Modern sophistication with a sleek black finish. Perfect for upscale listings and agents who want a contemporary look.',
    installationFee: 59,
    imageUrl: '/images/posts/black-post.png',
  },
  {
    name: 'Pink Signature Post',
    slug: 'pink',
    description:
      'Stand out from the crowd with our signature pink post. A bold statement that gets noticed and remembered by potential buyers.',
    installationFee: 65,
    featured: true,
    imageUrl: '/images/posts/pink-post.png',
  },
  {
    name: 'Metal Frame Sign',
    slug: 'metal-frame',
    description:
      'A budget-friendly option for standard real estate signage. Sturdy angle iron construction with a powder coated finish, fits 18"h x 24"w signs.',
    installationFee: 40,
    imageUrl: '/images/posts/metal-frame.jpg',
  },
]

export default function PostOptionsPage() {
  return (
    <div>
      <Header title="Post Options" />

      <div className="p-6">
        <p className="text-gray-600 mb-8">
          Choose the perfect post for your property signage. All posts include
          professional installation and removal.
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => (
            <PostCard
              key={post.slug}
              {...post}
              onSelect={() => {
                // Navigate to place order with post selected
                window.location.href = `/dashboard/place-order?post=${post.slug}`
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
