import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import { SessionProvider } from '@/components/providers/session-provider'
import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-poppins',
})

export const metadata: Metadata = {
  title: 'Pink Posts Installations | Professional Yard Sign Service',
  description: "Central Kentucky's trusted yard sign installation service for real estate professionals. Same-day installation, professional presentation, GPS-tracked service.",
  keywords: ['yard sign installation', 'real estate signs', 'Lexington KY', 'sign service', 'realtor signs'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className="font-sans antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
