import type { ReactNode } from 'react'

// Top of each marketing subpage: the page's headline in the sign lettering
// on a soft pink glow, a smaller echo of the homepage hero. The glow and the
// grain both fade to white at the bottom, so there's no edge where the
// white section below begins.
export function PageHeader({ title, lede, children }: { title: ReactNode; lede: ReactNode; children?: ReactNode }) {
  return (
    <section className="page-header lander-grain relative isolate overflow-hidden">
      <div className="relative mx-auto max-w-6xl px-4 pb-[clamp(2.5rem,6vw,4.5rem)] pt-[clamp(3rem,8vw,6rem)] sm:px-8">
        <h1 className="max-w-[13ch] font-display text-[clamp(3.2rem,9vw,7rem)] font-black leading-[0.88] tracking-[-0.01em] text-plum text-balance">
          {title}
        </h1>
        <div className="mt-5 max-w-xl text-lg leading-relaxed text-plum/75 sm:text-xl">{lede}</div>
        {children}
      </div>
    </section>
  )
}

// Short facts with the small pink square the homepage uses for its lists.
export function FactList({ items, className = '' }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={`grid gap-3 ${className}`}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 leading-relaxed text-plum/80">
          <span aria-hidden className="mt-[0.55em] h-2.5 w-2.5 shrink-0 bg-pink-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
