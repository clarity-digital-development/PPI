import { Big_Shoulders_Display, Manrope } from 'next/font/google'

// Marketing site type. Big Shoulders is a condensed face drawn from city
// signage, so the wordmark reads like lettering on a sign; Manrope carries
// the body copy. The dashboard keeps Poppins from the root layout.
export const displayFont = Big_Shoulders_Display({
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
})

export const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
