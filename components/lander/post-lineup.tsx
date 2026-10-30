import Image from 'next/image'
import Link from 'next/link'

const POSTS = [
  { name: 'White vinyl', price: 59, image: '/images/posts/white-post.png', alt: 'White vinyl colonial sign post in a front yard' },
  { name: 'Signature pink', price: 65, image: '/images/posts/pink-post.png', alt: 'The signature pink colonial sign post in a front yard', featured: true },
  { name: 'Black vinyl', price: 59, image: '/images/posts/black-post.png', alt: 'Black vinyl colonial sign post in a front yard' },
]

// The three posts as a lineup, the pink one standing taller in the middle.
// On phones all three stack, pink first, cropped wider so they're shorter.
export function PostLineup() {
  return (
    <section className="bg-white pt-[clamp(3rem,7vw,6rem)] pb-[clamp(4.5rem,11vw,9rem)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="md:flex md:items-end md:justify-between md:gap-10">
          <h2 className="font-display text-[clamp(2.6rem,6.4vw,5.25rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-plum max-w-[15ch]">
            White, black, or signature pink.
          </h2>
          <p className="mt-5 md:mt-0 max-w-sm text-lg leading-relaxed text-plum/75">
            Every post includes the install, and the pickup when it sells. If weather knocks it down, we reinstall it free.
          </p>
        </div>

        <div className="mt-12 grid gap-10 md:grid-cols-[1fr_1.18fr_1fr] md:items-end md:gap-7">
          {POSTS.map((post) => (
            <figure
              key={post.name}
              className={post.featured ? 'order-first md:order-none' : undefined}
            >
              <div className={`relative aspect-[4/3] overflow-hidden rounded-[4px] bg-blush ${post.featured ? 'md:aspect-[3/4.3]' : 'md:aspect-[3/4]'}`}>
                <Image
                  src={post.image}
                  alt={post.alt}
                  fill
                  sizes="(min-width: 768px) 30vw, 100vw"
                  className="object-cover object-[50%_24%] md:object-[50%_18%]"
                />
              </div>
              <figcaption className="mt-4 flex items-baseline justify-between gap-3">
                <span className={`font-display font-extrabold text-plum ${post.featured ? 'text-3xl' : 'text-2xl'}`}>{post.name}</span>
                <span className={`font-display font-black tabular-nums ${post.featured ? 'text-5xl text-pink-600' : 'text-4xl text-plum'}`}>
                  ${post.price}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-8 text-plum/75">
          Need a metal frame or wood panel post?{' '}
          <Link href="/posts" className="font-semibold text-pink-600 underline decoration-2 underline-offset-4 hover:text-raspberry">
            See every post option
          </Link>
        </p>
      </div>
    </section>
  )
}
