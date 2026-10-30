// What a bigger sign does, set as a staircase: each step bigger and further
// along than the last, landing on the deal. Follows the truck scene, as the
// payoff of swapping the wire stake for the post.
const STEPS = [
  { text: 'Bigger signs.', className: 'text-[clamp(2rem,4.6vw,3.6rem)] text-plum' },
  { text: 'More attention.', className: 'pl-[7%] text-[clamp(2.4rem,5.8vw,4.6rem)] text-plum' },
  { text: 'More calls.', className: 'pl-[14%] text-[clamp(2.8rem,7vw,5.8rem)] text-plum' },
  { text: 'More deals.', className: 'pl-[21%] text-[clamp(3.3rem,8.6vw,7.4rem)] text-pink-600' },
]

export function BiggerSigns() {
  return (
    <section className="bg-white py-[clamp(4rem,10vw,8rem)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <p className="font-display font-extrabold leading-[1] tracking-[-0.01em]">
          {STEPS.map((step) => (
            <span key={step.text} className={`block ${step.className}`}>
              {step.text}
            </span>
          ))}
        </p>
      </div>
    </section>
  )
}
