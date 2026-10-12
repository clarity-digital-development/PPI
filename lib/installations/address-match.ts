// Is a typed address the same property as one of our installations?
//
// Used when a customer books a removal for a sign that "isn't listed": if the
// address is really one on their list, it has to go through the listed removal
// (which marks the install removal_scheduled and bills the second half of an
// out-of-area fee), and when admin completes an unlisted removal it links any
// install rebuilt at that address since. A plain substring match is wrong both
// ways — "12 Main St" is inside "112 Main St", and "123 Main Street" isn't
// inside "123 Main St" — so both sides are normalized and compared whole.

const STREET_WORDS: Record<string, string> = {
  street: 'st', str: 'st',
  avenue: 'ave', av: 'ave',
  road: 'rd',
  drive: 'dr', drv: 'dr',
  court: 'ct',
  lane: 'ln',
  boulevard: 'blvd',
  circle: 'cir',
  place: 'pl',
  parkway: 'pkwy', pky: 'pkwy',
  highway: 'hwy',
  terrace: 'ter',
  trail: 'trl',
  cove: 'cv',
  point: 'pt',
  square: 'sq',
  crossing: 'xing',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
}

const CITY_WORDS: Record<string, string> = { mount: 'mt', saint: 'st', fort: 'ft' }

const STATES = new Set(['ky', 'oh', 'in', 'kentucky', 'ohio', 'indiana'])

// "#4", "Unit 4", "Apt 4" and "Suite 4" are one unit; the number is kept so
// different units at one address still differ.
const UNIT_WORDS = new Set(['unit', 'apt', 'apartment', 'ste', 'suite'])

function words(s: string): string[] {
  return s.toLowerCase().replace(/#/g, ' unit ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
}

export function streetKey(street: string): string {
  const out: string[] = []
  for (const w of words(street)) {
    const mapped = UNIT_WORDS.has(w) ? 'unit' : STREET_WORDS[w] ?? w
    if (mapped === 'unit' && out[out.length - 1] === 'unit') continue // "Unit #4"
    out.push(mapped)
  }
  return out.join(' ')
}

// "Lexington, KY" and "Lexington" are the same city.
export function cityKey(city: string): string {
  const w = words(city).map((x) => CITY_WORDS[x] ?? x)
  if (w.length > 1 && STATES.has(w[w.length - 1])) w.pop()
  return w.join(' ')
}

function zip5(zip: string | null | undefined): string {
  return (zip ?? '').match(/\d{5}/)?.[0] ?? ''
}

export interface PropertyAddress {
  street: string
  city: string
  zip?: string | null
}

// Same street (whole, after normalizing) and the same ZIP or city. Either one
// is enough so a mistyped ZIP or a "Lexington, KY" city still matches.
export function sameProperty(a: PropertyAddress, b: PropertyAddress): boolean {
  const street = streetKey(a.street)
  if (!street || street !== streetKey(b.street)) return false
  const za = zip5(a.zip)
  if (za && za === zip5(b.zip)) return true
  const city = cityKey(a.city)
  return !!city && city === cityKey(b.city)
}
