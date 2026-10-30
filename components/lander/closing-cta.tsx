import Link from 'next/link'

// The last ask, on a raspberry-to-pink field: the same two actions as the
// sign in the hero.
export function ClosingCta() {
  return (
    <section className="lander-grain relative isolate overflow-hidden bg-[radial-gradient(70%_90%_at_80%_0%,#ff5c8d_0%,transparent_60%),linear-gradient(160deg,#9e1748_0%,#c7325e_55%,#e84a7a_100%)] py-[clamp(4.5rem,11vw,8rem)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="font-display text-[clamp(2.8rem,7vw,6rem)] font-black leading-[0.88] tracking-[-0.01em] text-white max-w-[14ch]">
          Put a pink post in front of your next listing.
        </h2>
        <p className="mt-5 max-w-md text-lg text-white/90">
          Make an account in a minute, then order whenever you have a listing.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Link href="/sign-up" className="ring-btn">
            <span className="bg-white text-raspberry">Get started</span>
          </Link>
          <Link href="/sign-in" className="ring-btn">
            <span className="bg-raspberry text-white">Sign in</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
