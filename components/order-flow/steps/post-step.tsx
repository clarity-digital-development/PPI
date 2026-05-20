'use client'

import Image from 'next/image'
import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'

const premiumPosts = [
  {
    value: 'White Vinyl Post' as const,
    name: 'White Vinyl Post',
    description: 'Classic white vinyl post. Professional, clean look that complements any property.',
    price: PRICING.posts['White Vinyl Post'],
    image: '/images/posts/white-post.png',
  },
  {
    value: 'Black Vinyl Post' as const,
    name: 'Black Vinyl Post',
    description: 'Modern black vinyl post. Sleek, contemporary style for upscale listings.',
    price: PRICING.posts['Black Vinyl Post'],
    image: '/images/posts/black-post.png',
  },
  {
    value: 'Signature Pink Post' as const,
    name: 'Signature Pink Vinyl Post',
    description: 'Our signature pink post. Stand out from the crowd and get noticed!',
    price: PRICING.posts['Signature Pink Post'],
    image: '/images/posts/pink-post.png',
    featured: true,
  },
]

export function PostStep({ formData, updateFormData }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Select Your Post</h2>
        <p className="text-gray-600">Choose the post style for your installation, or skip if you only need other services.</p>
      </div>

      {/* Premium Vinyl Posts */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-pink-600 bg-pink-50 px-3 py-1 rounded-full">
            Premium Vinyl
          </span>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {premiumPosts.map((post) => (
            <button
              key={post.value}
              type="button"
              onClick={() => updateFormData({ post_type: post.value })}
              className={cn(
                'relative flex flex-col rounded-xl border-2 overflow-hidden transition-all text-left',
                formData.post_type === post.value
                  ? 'border-pink-500 ring-2 ring-pink-200'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              {post.featured && (
                <div className="absolute top-0 left-0 right-0 bg-pink-500 text-white text-xs font-semibold py-1 text-center z-10">
                  POPULAR CHOICE
                </div>
              )}

              <div className={cn('relative h-48 bg-gray-50', post.featured && 'mt-6')}>
                <Image
                  src={post.image}
                  alt={post.name}
                  fill
                  className="object-cover"
                  style={{ objectPosition: 'center 15%' }}
                />
              </div>

              <div className="p-4">
                <h3 className="font-semibold text-gray-900">{post.name}</h3>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{post.description}</p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-pink-600">${post.price}</span>
                  <span className="text-sm text-gray-500">installation & pickup</span>
                </div>
              </div>

              {formData.post_type === post.value && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-pink-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Budget Option - Metal Frame */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
            Standard
          </span>
        </div>
        <button
          type="button"
          onClick={() => updateFormData({ post_type: 'Metal Frame Sign' })}
          className={cn(
            'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.post_type === 'Metal Frame Sign'
              ? 'border-pink-500 ring-2 ring-pink-200 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300 bg-gray-50'
          )}
        >
          <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 relative">
            <Image
              src="/images/posts/metal-frame.jpg"
              alt="Metal Frame Sign"
              fill
              className="object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Metal Frame Sign</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Angle iron frame with powder coated finish. Works well with 18&quot;h x 24&quot;w signs.
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <span className="text-xl font-bold text-gray-700">${PRICING.posts['Metal Frame Sign']}</span>
            <p className="text-xs text-gray-500">install & pickup</p>
          </div>
          {formData.post_type === 'Metal Frame Sign' && (
            <div className="w-6 h-6 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>
      </div>

      {/* Wood Panel Post — commercial-style with tiered build/materials options */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
            Commercial
          </span>
        </div>
        <button
          type="button"
          onClick={() => updateFormData({ post_type: 'Wood Panel Post' })}
          className={cn(
            'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.post_type === 'Wood Panel Post'
              ? 'border-pink-500 ring-2 ring-pink-200 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300 bg-gray-50'
          )}
        >
          <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 relative bg-gray-100">
            <Image
              src="/images/posts/wood-panel-post.jpg"
              alt="Wood Panel Post"
              fill
              className="object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Wood Panel Post</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              4ft x 6ft commercial panel post with two beams.
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <span className="text-xl font-bold text-gray-700">${PRICING.posts['Wood Panel Post']}</span>
            <p className="text-xs text-gray-500">install & pickup</p>
          </div>
          {formData.post_type === 'Wood Panel Post' && (
            <div className="w-6 h-6 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>

        {/* Tiered build options — only shown when Wood Panel is selected */}
        {formData.post_type === 'Wood Panel Post' && (
          <div className="ml-4 mt-3 space-y-2 p-4 bg-amber-50/50 border border-amber-200 rounded-xl">
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.wood_panel_sign_build}
                  onChange={(e) => updateFormData({
                    wood_panel_sign_build: e.target.checked,
                    // If they don't need a sign built, they don't need materials either
                    ...(e.target.checked ? {} : { wood_panel_materials: false }),
                  })}
                  className="mt-1 w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900">I need my sign built</p>
                    <span className="text-sm font-semibold text-pink-600">+${PRICING.wood_panel_sign_build}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">We&apos;ll build the sign panel for you.</p>
                </div>
              </label>
            </div>

            {/* Materials option — only when sign-build is checked */}
            {formData.wood_panel_sign_build && (
              <div className="ml-7 pl-3 border-l-2 border-amber-300 space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="wood_panel_materials"
                    checked={!formData.wood_panel_materials}
                    onChange={() => updateFormData({ wood_panel_materials: false })}
                    className="mt-1 w-4 h-4 border-gray-300 text-pink-600 focus:ring-pink-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">I have all needed materials</p>
                      <span className="text-sm font-semibold text-gray-600">$0</span>
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="wood_panel_materials"
                    checked={formData.wood_panel_materials}
                    onChange={() => updateFormData({ wood_panel_materials: true })}
                    className="mt-1 w-4 h-4 border-gray-300 text-pink-600 focus:ring-pink-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">I need materials</p>
                      <span className="text-sm font-semibold text-pink-600">+${PRICING.wood_panel_materials}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Includes 4x4 posts, screws, and washers.</p>
                  </div>
                </label>
              </div>
            )}

            {/* Live total */}
            <div className="flex items-center justify-between pt-2 mt-2 border-t border-amber-300">
              <p className="text-sm font-semibold text-gray-900">Wood panel total</p>
              <p className="text-sm font-bold text-pink-700">
                ${(
                  PRICING.posts['Wood Panel Post'] +
                  (formData.wood_panel_sign_build ? PRICING.wood_panel_sign_build : 0) +
                  (formData.wood_panel_sign_build && formData.wood_panel_materials ? PRICING.wood_panel_materials : 0)
                ).toFixed(2)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Open House / Wire Frame Only */}
      <div>
        <button
          type="button"
          onClick={() => updateFormData({ post_type: 'open_house' })}
          className={cn(
            'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.post_type === 'open_house'
              ? 'border-pink-500 ring-2 ring-pink-200 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300 bg-gray-50'
          )}
        >
          <div className={cn(
            'w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0',
            formData.post_type === 'open_house' ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-500'
          )}>
            <Flag className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Open House/Wire Frame Only</h3>
            <p className="text-xs text-gray-500 mt-1">
              Min $40 order. Signs must be in inventory prior to installation. Will be installed after 5pm on Friday. If pickup is desired, another order must be placed for an additional $5 per sign and will be picked up after 5pm on Sunday. Any missing or removed signs will not be the responsibility of Pink Posts. Select install quantity in the wire frame section under &quot;Riders&quot; (step 4) of your order form.
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <span className="text-xl font-bold text-gray-700">$0</span>
            <p className="text-xs text-gray-500">post fee</p>
          </div>
          {formData.post_type === 'open_house' && (
            <div className="w-6 h-6 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-gray-500">or continue without a post</span>
        </div>
      </div>

      {/* No Post Needed Option */}
      <button
        type="button"
        onClick={() => updateFormData({ post_type: undefined })}
        className={cn(
          'w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4',
          formData.post_type === undefined
            ? 'border-pink-500 ring-2 ring-pink-200 bg-pink-50'
            : 'border-gray-200 hover:border-gray-300'
        )}
      >
        <div className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0',
          formData.post_type === undefined ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-400'
        )}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">No Post Needed</h3>
          <p className="text-sm text-gray-600">I only need riders, lockbox, brochure box, or other services</p>
          <p className="text-sm text-amber-600 font-medium mt-1">A ${PRICING.no_post_surcharge} service trip fee applies</p>
        </div>
        {formData.post_type === undefined && (
          <div className="ml-auto w-6 h-6 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </button>
    </div>
  )
}
