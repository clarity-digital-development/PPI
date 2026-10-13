'use client'

import { forwardRef, useId, InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
  helperText?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, helperText, type = 'text', id, ...props }, ref) => {
    // Ties the label to the input so screen readers name it; a caller's id wins.
    const autoId = useId()
    const inputId = id ?? autoId
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              {icon}
            </div>
          )}
          <input
            id={inputId}
            type={type}
            ref={ref}
            className={cn(
              'block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5',
              'text-gray-900 placeholder:text-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent',
              'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
              'transition-all duration-200',
              icon && 'pl-10',
              error && 'border-error focus:ring-error',
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-error">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

export { Input }
