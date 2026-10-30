// What agents get, in plain facts. A dark plum band between the blush and
// white sections, two columns of short entries, no icons or cards.
const FACTS = [
  { title: 'Next-day installs', body: 'Orders in by 4pm go in the ground the next day. Same day when we can, for an expedite fee.' },
  { title: 'Install and pickup included', body: "When it sells, we pull it. The pickup is in the price, so there's no surprise charge." },
  { title: 'Your inventory, stored free', body: 'Signs, riders, and lockboxes stay with us between listings, and your dashboard shows what we have.' },
  { title: 'Book any time', body: 'Installs, removals, and service calls from your dashboard, day or night.' },
  { title: 'No contracts', body: 'Pay for each order as you place it. Stop whenever you like.' },
  { title: 'Weather happens', body: 'If a storm knocks your post down, we put it back at no cost, usually within 24 hours.' },
]

export function WhyAgents() {
  return (
    <section className="bg-plum py-[clamp(4.5rem,11vw,9rem)] text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="font-display text-[clamp(2.6rem,6.4vw,5.25rem)] font-extrabold leading-[0.9] tracking-[-0.01em] max-w-[16ch]">
          Run by a licensed broker who knows what a listing needs.
        </h2>
        <dl className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 md:mt-20 lg:grid-cols-3">
          {FACTS.map((fact) => (
            <div key={fact.title}>
              <dt className="flex items-center gap-3 font-display text-2xl font-extrabold">
                <span aria-hidden className="h-3 w-3 shrink-0 bg-pink-400" />
                {fact.title}
              </dt>
              <dd className="mt-2 pl-6 leading-relaxed text-white/75">{fact.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
