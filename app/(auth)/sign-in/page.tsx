'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Mail, Lock, Eye, EyeOff, KeyRound } from 'lucide-react'
import { Card, CardContent, Button, Input } from '@/components/ui'

type Mode = 'signin' | 'new'
type NewStep = 'email' | 'code'

const RESEND_SECONDS = 60

export default function SignInPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}

function SignInForm() {
  const router = useRouter()
  const params = useSearchParams()
  // Accounts carried over to the new site (October 2026) have no password, so
  // "choose a new password" lives on this page: an emailed code proves the
  // email is theirs, then they type the new password twice. A failed sign-in
  // on such an account switches here by itself (lib/passwords/code.ts).
  const [mode, setMode] = useState<Mode>(params.get('new') === '1' ? 'new' : 'signin')
  // The code email links back here on the code step (?new=1&step=code&email=).
  const [newStep, setNewStep] = useState<NewStep>(params.get('step') === 'code' ? 'code' : 'email')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  function startNewPassword() {
    setMode('new')
    setNewStep('email')
    setError('')
    setInfo('')
  }

  function backToSignIn() {
    setMode('signin')
    setError('')
    setInfo('')
    setCode('')
    setNewPassword('')
    setConfirmPassword('')
  }

  // quiet: the check after a failed sign-in, whose own errors (e.g. a busy
  // office hitting the request limit) shouldn't replace "Invalid email or
  // password". resend: the "Send a new code" button, the only thing that
  // replaces a code already in the customer's inbox.
  async function requestCode(
    firstSignIn: boolean,
    opts: { quiet?: boolean; resend?: boolean } = {},
  ): Promise<{ codeSent: boolean; alreadySent: boolean } | null> {
    const res = await fetch('/api/auth/password-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, firstSignIn, resend: !!opts.resend }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (!opts.quiet) setError(data.error || "We couldn't send a code. Please try again.")
      return null
    }
    if (data.codeSent && !data.alreadySent) setResendIn(RESEND_SECONDS)
    return { codeSent: !!data.codeSent, alreadySent: !!data.alreadySent }
  }

  async function sendResetLink() {
    setError('')
    setInfo('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error()
      setInfo(`If there's an account for ${email}, we've emailed it a link to choose a new password.`)
    } catch {
      setError("We couldn't send the link. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setInfo('')
    try {
      const result = await signIn('credentials', { email, password, redirect: false })
      if (result?.error) {
        // An account carried over without a password: go straight to
        // choosing one, with the code already on its way.
        const sent = await requestCode(true, { quiet: true })
        if (sent?.codeSent) {
          setMode('new')
          setNewStep('code')
          setPassword('')
          setInfo(
            `Welcome to the new Pink Posts site. Your account came over, but it needs a new password. We emailed a 6-digit code to ${email}.`,
          )
        } else {
          setError('Invalid email or password')
        }
        setIsLoading(false)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  const handleSendCode = async (e?: React.FormEvent, resend = false) => {
    e?.preventDefault()
    setIsLoading(true)
    setError('')
    setInfo('')
    try {
      const sent = await requestCode(false, { resend })
      if (sent) {
        setNewStep('code')
        setInfo(
          sent.alreadySent && !resend
            ? `We already emailed a code to ${email}. It can take a minute to arrive, so check spam too.`
            : `If there's an account for ${email}, we've emailed it a 6-digit code.`,
        )
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError("The two passwords don't match.")
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/password-code/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password: newPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "We couldn't set your password. Please try again.")
        setIsLoading(false)
        return
      }
      const result = await signIn('credentials', { email, password: newPassword, redirect: false })
      if (result?.error) {
        setMode('signin')
        setInfo('Your new password is saved. Please sign in with it.')
        setIsLoading(false)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword(!showPassword)}
      className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
      aria-label={showPassword ? 'Hide password' : 'Show password'}
    >
      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
    </button>
  )

  return (
    <Card variant="elevated" className="shadow-xl">
      <CardContent className="p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {mode === 'signin' ? 'Welcome Back' : 'Choose a New Password'}
          </h1>
          <p className="mt-2 text-gray-600">
            {mode === 'signin'
              ? 'Sign in to manage your installations'
              : newStep === 'email'
                ? "We'll email you a code to confirm it's you."
                : 'Enter the code from your email and your new password twice.'}
          </p>
        </div>

        {mode === 'signin' && (
          <div className="mb-5 p-3 bg-pink-50 border border-pink-200 text-pink-900 text-sm rounded-lg">
            <strong>We&apos;ve moved to a new site.</strong> Signing in for the first time since then?{' '}
            <button type="button" onClick={startNewPassword} className="font-medium underline hover:text-pink-700">
              Choose a new password
            </button>
          </div>
        )}

        {info && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg">{info}</div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg">{error}</div>
        )}

        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-5">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              icon={<Mail className="w-5 h-5" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                icon={<Lock className="w-5 h-5" />}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              {passwordToggle}
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-gray-600">
                <input type="checkbox" className="rounded border-gray-300 text-pink-500 focus:ring-pink-500" />
                Remember me
              </label>
              <button type="button" onClick={startNewPassword} className="text-pink-600 hover:text-pink-700">
                Forgot password?
              </button>
            </div>
            <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
              Sign In
            </Button>
          </form>
        )}

        {mode === 'new' && newStep === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-5">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              icon={<Mail className="w-5 h-5" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
              Email Me a Code
            </Button>
            <div className="text-center text-sm">
              <button
                type="button"
                onClick={() => { setError(''); setInfo(''); setNewStep('code') }}
                disabled={!email}
                className="text-pink-600 hover:text-pink-700 disabled:text-gray-400"
              >
                I already have a code
              </button>
            </div>
          </form>
        )}

        {mode === 'new' && newStep === 'code' && (
          <form onSubmit={handleSetPassword} className="space-y-5">
            <Input
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              icon={<KeyRound className="w-5 h-5" />}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            <div className="relative">
              <Input
                label="New password"
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 8 characters"
                icon={<Lock className="w-5 h-5" />}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              {passwordToggle}
            </div>
            <Input
              label="New password again"
              type={showPassword ? 'text' : 'password'}
              placeholder="Type it again"
              icon={<Lock className="w-5 h-5" />}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-gray-500">
              At least 8 characters, with an uppercase letter, a lowercase letter and a number.
            </p>
            <Button type="submit" className="w-full" size="lg" isLoading={isLoading} disabled={code.length !== 6}>
              Set Password and Sign In
            </Button>
            <div className="text-center text-sm text-gray-600">
              {resendIn > 0 ? (
                <span>You can send a new code in {resendIn}s</span>
              ) : (
                <button type="button" onClick={() => handleSendCode(undefined, true)} className="text-pink-600 hover:text-pink-700">
                  Send a new code
                </button>
              )}
            </div>
          </form>
        )}

        {mode === 'new' && (
          <div className="mt-4 text-center text-sm text-gray-500">
            Trouble with the code?{' '}
            <button
              type="button"
              onClick={sendResetLink}
              disabled={!email || isLoading}
              className="text-pink-600 hover:text-pink-700 disabled:text-gray-400"
            >
              Email me a reset link instead
            </button>
          </div>
        )}

        <div className="mt-6 text-center text-sm text-gray-600">
          {mode === 'new' ? (
            <button type="button" onClick={backToSignIn} className="text-pink-600 hover:text-pink-700 font-medium">
              Back to sign in
            </button>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <Link href="/sign-up" className="text-pink-600 hover:text-pink-700 font-medium">
                Sign up
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
