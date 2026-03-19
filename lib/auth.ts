import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import {
  isAccountLocked,
  trackFailedLogin,
  clearFailedLogins,
  getLockoutTimeRemaining,
} from '@/lib/rate-limit'

export const authOptions: NextAuthOptions = {
  // Note: PrismaAdapter removed - not needed for JWT strategy with credentials provider
  // and can cause issues if schema has relations to tables that don't exist yet
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required')
        }

        // Check if account is locked due to too many failed attempts
        const normalizedEmail = credentials.email.toLowerCase().trim()

        if (isAccountLocked(normalizedEmail)) {
          const remaining = getLockoutTimeRemaining(normalizedEmail)
          const minutes = Math.ceil(remaining / 60)
          throw new Error(`Account temporarily locked. Try again in ${minutes} minute(s).`)
        }

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        })

        if (!user || !user.password) {
          trackFailedLogin(normalizedEmail)
          throw new Error('Invalid email or password')
        }

        const isValid = await bcrypt.compare(credentials.password, user.password)

        if (!isValid) {
          trackFailedLogin(normalizedEmail)
          throw new Error('Invalid email or password')
        }

        // Clear failed attempts on successful login
        clearFailedLogins(normalizedEmail)

        return {
          id: user.id,
          email: user.email,
          name: user.fullName || user.name,
          role: user.role,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    },
  },
  pages: {
    signIn: '/sign-in',
    signOut: '/',
    error: '/sign-in',
  },
}
