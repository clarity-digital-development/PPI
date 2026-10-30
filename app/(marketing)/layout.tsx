import { Navbar } from '@/components/shared'
import { Footer } from '@/components/marketing'
import { bodyFont, displayFont } from '@/components/lander/fonts'
import '@/components/lander/lander.css'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className={`${displayFont.variable} ${bodyFont.variable} font-body text-plum min-h-screen flex flex-col`}>
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
