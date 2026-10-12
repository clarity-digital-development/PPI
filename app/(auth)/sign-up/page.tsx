'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Mail, Lock, User, Phone, Building, Eye, EyeOff } from 'lucide-react'
import { Card, CardContent, Button, Input } from '@/components/ui'

export default function SignUpPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    companyName: '',
    password: '',
    confirmPassword: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    // Validate password strength
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      setIsLoading(false)
      return
    }

    try {
      // Register the user
      const registerRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          phone: formData.phone,
          company: formData.companyName,
        }),
      })

      const registerData = await registerRes.json()

      if (!registerRes.ok) {
        // An account carried over to the new site: choose a password on the
        // sign-in page instead of signing up again.
        if (registerData.code === 'needs_new_password') {
          router.push(`/sign-in?new=1&email=${encodeURIComponent(formData.email)}`)
          return
        }
        setError(registerData.error || 'Failed to create account')
        setIsLoading(false)
        return
      }

      // Sign in after successful registration
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false,
      })

      if (result?.error) {
        setError('Account created but sign in failed. Please try signing in.')
        setIsLoading(false)
        return
      }

      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <Card variant="elevated" className="shadow-xl">
      <CardContent className="p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Create Account</h1>
          <p className="mt-2 text-gray-600">
            Get started with Pink Posts today
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Full Name"
            type="text"
            placeholder="Jane Doe"
            icon={<User className="w-5 h-5" />}
            value={formData.fullName}
            onChange={(e) =>
              setFormData({ ...formData, fullName: e.target.value })
            }
            required
          />

          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            icon={<Mail className="w-5 h-5" />}
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            required
          />

          <Input
            label="Phone"
            type="tel"
            placeholder="(859) 555-0123"
            icon={<Phone className="w-5 h-5" />}
            value={formData.phone}
            onChange={(e) =>
              setFormData({ ...formData, phone: e.target.value })
            }
          />

          <Input
            label="Company/Brokerage (Optional)"
            type="text"
            placeholder="ABC Realty"
            icon={<Building className="w-5 h-5" />}
            value={formData.companyName}
            onChange={(e) =>
              setFormData({ ...formData, companyName: e.target.value })
            }
          />

          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Create a password (min 8 characters)"
              icon={<Lock className="w-5 h-5" />}
              value={formData.password}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>

          <Input
            label="Confirm Password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Confirm your password"
            icon={<Lock className="w-5 h-5" />}
            value={formData.confirmPassword}
            onChange={(e) =>
              setFormData({ ...formData, confirmPassword: e.target.value })
            }
            required
          />

          <div className="pt-2">
            <label className="flex items-start gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-pink-500 focus:ring-pink-500 mt-0.5"
                required
              />
              <span>
                I agree to the{' '}
                <Link href="/terms" className="text-pink-600 hover:text-pink-700">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="text-pink-600 hover:text-pink-700">
                  Privacy Policy
                </Link>
              </span>
            </label>
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            isLoading={isLoading}
          >
            Create Account
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link
            href="/sign-in"
            className="text-pink-600 hover:text-pink-700 font-medium"
          >
            Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
