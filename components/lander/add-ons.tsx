// Riders and lockboxes as a price board, next to a small drawing of riders
// hanging under a sign the way they do on the real post.
const PRICES = [
  { item: 'Rent one of our riders', note: 'Open House, Pending, Coming Soon, and 20+ more', price: '$5' },
  { item: 'We install your rider', note: 'Name riders, bedroom counts, anything you have', price: '$2' },
  { item: 'We install your lockbox', note: 'SentriLock, Bluetooth, or a combination lockbox', price: '$5' },
  { item: 'Rent one of our lockboxes', note: 'We provide it and install it', price: '$10' },
]

const RIDERS = ['Open House', 'Pending', 'Coming Soon']

export function AddOns() {
  return (
    <section className="bg-blush py-[clamp(4.5rem,11vw,9rem)]">
      <div className="mx-auto grid max-w-6xl gap-14 px-4 sm:px-8 md:grid-cols-[0.9fr_1.1fr] md:items-center md:gap-16">
        <div>
          <h2 className="font-display text-[clamp(2.6rem,6.4vw,5.25rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-plum">
            Riders and lockboxes, on the same trip.
          </h2>

          {/* Riders hanging under a sign */}
          <div aria-hidden className="mt-10 w-full max-w-sm">
            <div className="rounded-[4px] border-[3px] border-pink-500 bg-white px-5 py-4 text-center font-display text-4xl font-black text-plum shadow-[0_18px_30px_-22px_rgba(107,24,49,0.6)]">
              FOR SALE
            </div>
            {RIDERS.map((rider) => (
              <div key={rider} className="mx-auto w-[86%]">
                <div className="flex justify-between px-[16%]">
                  <span className="block h-3.5 w-[3px] bg-[#9aa0a6]" />
                  <span className="block h-3.5 w-[3px] bg-[#9aa0a6]" />
                </div>
                <div className="rounded-[3px] bg-pink-600 py-2 text-center font-display text-xl font-extrabold uppercase tracking-wide text-white shadow-[0_12px_20px_-16px_rgba(107,24,49,0.7)]">
                  {rider}
                </div>
              </div>
            ))}
          </div>
        </div>

        <dl className="divide-y-2 divide-white">
          {PRICES.map((row) => (
            <div key={row.item} className="flex items-baseline gap-4 py-5">
              <div className="min-w-0 flex-1">
                <dt className="font-display text-2xl font-extrabold text-plum sm:text-[1.7rem]">{row.item}</dt>
                <p className="mt-1 text-[0.95rem] text-plum/70">{row.note}</p>
              </div>
              <dd className="font-display text-4xl font-black tabular-nums text-pink-600">{row.price}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
