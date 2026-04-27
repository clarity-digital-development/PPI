'use client'

import { useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ZoomIn } from 'lucide-react'

interface ExpandableImageProps {
  src: string
  alt: string
  thumbClassName?: string
  thumbSizes?: string
}

export function ExpandableImage({
  src,
  alt,
  thumbClassName = 'relative w-full sm:w-32 h-40 sm:h-32 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100',
  thumbSizes = '(max-width: 640px) 100vw, 128px',
}: ExpandableImageProps) {
  const [expanded, setExpanded] = useState(false)

  if (expanded) {
    return (
      <motion.button
        type="button"
        onClick={() => setExpanded(false)}
        layout
        initial={{ opacity: 0.6, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-2xl mx-auto rounded-2xl overflow-hidden bg-gray-100 cursor-zoom-out shadow-xl ring-1 ring-pink-200/60"
        aria-label={`Collapse ${alt}`}
      >
        <Image
          src={src}
          alt={alt}
          width={1200}
          height={1600}
          sizes="(max-width: 768px) 100vw, 672px"
          className="w-full h-auto object-contain"
        />
      </motion.button>
    )
  }

  return (
    <motion.button
      type="button"
      onClick={() => setExpanded(true)}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`${thumbClassName} group cursor-zoom-in`}
      aria-label={`Expand ${alt}`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover"
        sizes={thumbSizes}
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-2">
          <ZoomIn className="w-4 h-4 text-gray-700" />
        </div>
      </div>
    </motion.button>
  )
}
