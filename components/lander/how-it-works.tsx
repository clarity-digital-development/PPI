// A real timeline, so the steps are named by when they happen rather than
// numbered. Sits on a solid pink band: white for the big type, plum for body
// copy (white on this pink is only readable at large sizes).
const STEPS = [
  {
    when: 'Today, by 4pm',
    what: 'Order online in a couple of minutes: the post, your sign, riders, and a lockbox if you need one.',
  },
  {
    when: 'Tomorrow',
    what: "It's in the ground. Need it today? Ask about a same-day install for an expedite fee.",
  },
  {
    when: 'When it sells',
    what: 'Schedule the pickup from your dashboard. We can hang the SOLD sign first.',
  },
  {
    when: 'Between listings',
    what: 'Your signs, riders, and lockboxes wait in our storage, free, ready for the next one.',
  },
]

export function HowItWorks() {
  return (
    <section className="bg-pink-500 py-[clamp(4.5rem,11vw,9rem)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="font-display text-[clamp(2.6rem,6.4vw,5.25rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-white max-w-[18ch]">
          Order by 4pm. It&apos;s up tomorrow.
        </h2>

        <ol className="mt-14 grid gap-10 md:mt-20 md:grid-cols-4 md:gap-8">
          {STEPS.map((step) => (
            <li key={step.when} className="relative border-l-4 border-white/60 pl-5 md:border-l-0 md:border-t-4 md:pl-0 md:pt-6">
              <p className="font-display text-[1.9rem] font-extrabold leading-none text-white">{step.when}</p>
              <p className="mt-3 text-base leading-relaxed text-plum">{step.what}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
