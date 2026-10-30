import localFont from 'next/font/local'

// Marketing site type. Big Shoulders is a condensed face drawn from city
// signage, so the wordmark reads like lettering on a sign; Manrope carries
// the body copy. The dashboard keeps Poppins from the root layout.
//
// Both are served from this repo (Latin variable fonts from Google Fonts,
// SIL Open Font License) rather than fetched from Google at build time: a
// failed fetch there fails the whole deploy.
export const displayFont = localFont({
  src: './fonts/big-shoulders-display-latin.woff2',
  weight: '100 900',
  variable: '--font-display',
  display: 'swap',
})

export const bodyFont = localFont({
  src: './fonts/manrope-latin.woff2',
  weight: '200 800',
  variable: '--font-body',
  display: 'swap',
})
