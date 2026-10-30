import Image from 'next/image'
import Link from 'next/link'

const POSTS = [
  { name: 'White vinyl', image: '/images/posts/white-post.png', alt: 'White vinyl colonial sign post in a front yard' },
  { name: 'Signature pink', image: '/images/posts/pink-post.png', alt: 'The signature pink colonial sign post in a front yard', featured: true },
  { name: 'Black vinyl', image: '/images/posts/black-post.png', alt: 'Black vinyl colonial sign post in a front yard' },
]

// The three posts as a lineup, the pink one standing taller in the middle.
// Each is a bordered card with its name centered under the photo, like the
// old cards. On phones all three stack, pink first.
export function PostLineup() {
  return (
    <section className="bg-white pt-[clamp(3rem,7vw,6rem)] pb-[clamp(4.5rem,11vw,9rem)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="md:flex md:items-end md:justify-between md:gap-10">
          <h2 className="font-display text-[clamp(2.6rem,6.4vw,5.25rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-plum max-w-[15ch]">
            White, black, or signature <span className="text-pink-500">pink</span>.
          </h2>
          <p className="mt-5 md:mt-0 max-w-sm text-lg leading-relaxed text-plum/75">
            Every post includes the install, and the pickup when it sells. If weather knocks it down, we reinstall it free.
          </p>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-[1fr_1.18fr_1fr] md:items-end md:gap-7">
          {POSTS.map((post) => (
            <figure
              key={post.name}
              className={`overflow-hidden rounded-[6px] border-2 bg-white ${
                post.featured
                  ? 'order-first border-pink-500 shadow-[0_24px_40px_-28px_rgba(199,50,94,0.7)] md:order-none'
                  : 'border-[#f2d4df]'
              }`}
            >
              {/* Trimmed to the top of the post so the row stays short. */}
              <div className={`relative h-56 bg-blush ${post.featured ? 'md:h-80' : 'md:h-72'}`}>
                <Image
                  src={post.image}
                  alt={post.alt}
                  fill
                  sizes="(min-width: 768px) 30vw, 100vw"
                  className="object-cover object-[50%_15%]"
                />
              </div>
              <figcaption
                className={`border-t-2 py-4 text-center font-display text-[1.75rem] font-extrabold leading-none ${
                  post.featured ? 'border-pink-500 text-pink-600' : 'border-[#f2d4df] text-plum'
                }`}
              >
                {post.name}
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-8 text-center text-plum/75">
          Need a metal frame or wood panel post?{' '}
          <Link href="/posts" className="font-semibold text-pink-600 underline decoration-2 underline-offset-4 hover:text-raspberry">
            See every post option
          </Link>
        </p>
      </div>
    </section>
  )
}
