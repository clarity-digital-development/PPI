// Same questions and answers as the old homepage, as native disclosure
// widgets so they work without JavaScript and with a keyboard.
const QUESTIONS = [
  {
    q: 'How quickly can you install my sign?',
    a: 'We offer next day installation for orders placed before 4pm. We strive for same day installations for an expedite fee if possible. We can also schedule installations for a specific date.',
  },
  {
    q: 'What areas do you serve?',
    a: 'We currently serve the greater Lexington, Central Kentucky, Louisville, Cincinnati, and surrounding areas!',
  },
  {
    q: 'What happens if my post is damaged?',
    a: 'If your post is damaged due to weather or normal wear and tear, notify us and we will replace for no cost within 24 hours. We strive for same day service, and replacement orders are always on priority.',
  },
  {
    q: 'Can I use my own signs?',
    a: 'Yes, we install your sign on our posts. Just provide the sign for us to hold in storage, or have ready for pickup at the property and we will install.',
  },
  {
    q: 'What are your payment terms?',
    a: 'Payment is made during each order for what you ordered. There are no storage fees and we will keep your inventory amounts available in your dashboard for anytime you need to order.',
  },
]

export function Faq() {
  return (
    <section className="bg-white py-[clamp(4.5rem,11vw,9rem)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-8 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
        <div>
          <h2 className="font-display text-[clamp(2.6rem,6.4vw,5.25rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-plum">
            Questions agents ask
          </h2>
          <p className="mt-5 text-lg text-plum/75">
            Something else? Call or text{' '}
            <a href="tel:+18593958188" className="font-semibold text-pink-600 underline decoration-2 underline-offset-4">
              859-395-8188
            </a>
            .
          </p>
        </div>
        <div className="divide-y-2 divide-blush border-y-2 border-blush">
          {QUESTIONS.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-2xl font-extrabold text-plum focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pink-600 [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden className="relative h-5 w-5 shrink-0">
                  <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-pink-600" />
                  <span className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-pink-600 transition-transform duration-200 group-open:scale-y-0" />
                </span>
              </summary>
              <p className="mt-3 max-w-[60ch] leading-relaxed text-plum/80">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
