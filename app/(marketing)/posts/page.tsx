import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { PRICING } from '@/components/order-flow/types'
import { PageHeader, FactList } from '@/components/lander/page-header'
import { ClosingCta } from '@/components/lander/closing-cta'
import { MobileOrderBar } from '@/components/lander/mobile-order-bar'

export const metadata: Metadata = {
  title: 'Posts | Pink Posts Installations',
  description: 'White, black, or signature pink 6-foot vinyl posts, plus metal frames and wood panel posts. Installed and picked up for you.',
}

// Prices come from the order form's own table, so this page can't drift
// from what agents are charged.
const VINYL = [
  {
    name: 'White vinyl',
    price: PRICING.posts['White Vinyl Post'],
    image: '/images/posts/white-post.png',
    alt: 'White vinyl colonial sign post in a front yard',
    note: 'Classic and clean. Goes with any house.',
  },
  {
    name: 'Signature pink',
    price: PRICING.posts['Signature Pink Post'],
    image: '/images/posts/pink-post.png',
    alt: 'The signature pink colonial sign post in a front yard',
    note: 'Stands out on any street and gets your listing noticed.',
    featured: true,
  },
  {
    name: 'Black vinyl',
    price: PRICING.posts['Black Vinyl Post'],
    image: '/images/posts/black-post.png',
    alt: 'Black vinyl colonial sign post in a front yard',
    note: 'Sleek and modern, for upscale listings.',
  },
]

const OTHER_POSTS = [
  {
    name: 'Metal frame',
    price: PRICING.posts['Metal Frame Sign'],
    image: '/images/posts/metal-frame.jpg',
    alt: 'A metal frame yard sign on a lawn',
    body: 'An angle iron frame with a powder-coated finish. Holds 18 by 24 inch signs.',
  },
  {
    name: 'Wood panel post',
    price: PRICING.posts['Wood Panel Post'],
    image: '/images/posts/wood-panel-post.jpg',
    alt: 'A commercial wood panel post with two beams by a road',
    body: `A 4 by 6 foot commercial panel post with two beams. We can build the sign panel for $${PRICING.wood_panel_sign_build}, plus $${PRICING.wood_panel_materials} if we supply the materials.`,
  },
  {
    name: 'Your own post',
    price: PRICING.posts['My Own Post'],
    body: 'Already have a post? We install it and pick it up when the listing sells, the same as one of ours.',
  },
]

export default function PostsPage() {
  return (
    <>
      <PageHeader
        title={<>Premium <span className="whitespace-nowrap">6-foot</span> posts.</>}
        lede="Every post includes the install, and the pickup when it sells. If weather knocks it down, we reinstall it free."
      />

      {/* The three vinyl posts */}
      <section className="bg-white pb-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <div className="grid gap-8 md:grid-cols-[1fr_1.18fr_1fr] md:items-end md:gap-7">
            {VINYL.map((post) => (
              <figure
                key={post.name}
                className={`overflow-hidden rounded-[6px] border-2 bg-white ${
                  post.featured
                    ? 'order-first border-pink-500 shadow-[0_24px_40px_-28px_rgba(199,50,94,0.7)] md:order-none'
                    : 'border-[#f2d4df]'
                }`}
              >
                <div className={`relative h-64 bg-blush ${post.featured ? 'md:h-96' : 'md:h-80'}`}>
                  <Image src={post.image} alt={post.alt} fill sizes="(min-width: 768px) 30vw, 100vw" className="object-cover object-[50%_20%]" />
                </div>
                <figcaption className={`border-t-2 px-5 py-5 text-center ${post.featured ? 'border-pink-500' : 'border-[#f2d4df]'}`}>
                  <p className={`font-display text-[2rem] font-extrabold leading-none ${post.featured ? 'text-pink-600' : 'text-plum'}`}>{post.name}</p>
                  <p className="mt-2 text-plum/75">{post.note}</p>
                  <p className="mt-3 font-display text-4xl font-black tabular-nums text-pink-600">
                    ${post.price}
                    <span className="ml-2 align-middle font-body text-sm font-semibold text-plum/60">installed and picked up</span>
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
          <FactList
            className="mx-auto mt-10 max-w-3xl sm:grid-cols-3"
            items={['6 feet tall, so the sign reads from the street', 'Weather-resistant vinyl', 'Hardware included']}
          />
        </div>
      </section>

      {/* Other ways to post */}
      <section className="bg-blush py-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <h2 className="max-w-[16ch] font-display text-[clamp(2.4rem,5.6vw,4.5rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-plum">
            Need something else?
          </h2>
          <ul className="mt-10 grid gap-5 md:grid-cols-3 md:gap-7">
            {OTHER_POSTS.map((post) => (
              <li key={post.name} className="flex flex-col overflow-hidden rounded-[6px] border-2 border-[#f2d4df] bg-white">
                {post.image ? (
                  <div className="relative -mx-[2px] -mt-[2px] aspect-[4/3] overflow-hidden rounded-t-[6px] border-2 border-pink-500">
                    <Image src={post.image} alt={post.alt} fill sizes="(min-width: 768px) 30vw, 100vw" className="object-cover" />
                  </div>
                ) : (
                  // No photo for an agent's own post: a plain post drawn in.
                  <div aria-hidden className="relative -mx-[2px] -mt-[2px] grid aspect-[4/3] place-items-center overflow-hidden rounded-t-[6px] border-2 border-pink-500 bg-[radial-gradient(70%_80%_at_50%_100%,#ffd3e1_0%,#fff7fa_70%)]">
                    <div className="relative h-[70%] w-[46%]">
                      <span className="absolute bottom-0 left-[10%] top-[6%] w-[11%] bg-[linear-gradient(90deg,#e9e3e6_0,#d8cfd4_56%,#c5bac0_56%)]" />
                      <span className="absolute left-0 top-[16%] h-[7%] w-full bg-[linear-gradient(180deg,#f1ecee_0,#f1ecee_30%,#d8cfd4_30%)]" />
                      <span className="absolute left-[30%] right-[6%] top-[30%] grid h-[34%] place-items-center rounded-[3px] border-2 border-dashed border-pink-500 bg-white font-display text-xl font-black text-pink-600">
                        Yours
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-display text-[1.8rem] font-extrabold leading-none text-plum">{post.name}</p>
                    <p className="font-display text-3xl font-black tabular-nums text-pink-600">${post.price}</p>
                  </div>
                  <p className="mt-3 leading-relaxed text-plum/75">{post.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Extras that go on the post */}
      <section className="bg-white py-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-8 md:grid-cols-[1fr_1fr] md:items-center md:gap-16">
          <div className="relative aspect-[4/5] max-h-[34rem] overflow-hidden rounded-[6px] border-2 border-pink-500 md:aspect-auto md:h-[34rem]">
            <Image src="/images/posts/solar-light.jpg" alt="A yard sign lit up at night by a solar light" fill sizes="(min-width: 768px) 45vw, 100vw" className="object-cover" />
          </div>
          <div>
            <h2 className="max-w-[14ch] font-display text-[clamp(2.4rem,5.6vw,4.5rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-plum">
              Extras for the post.
            </h2>
            <dl className="mt-8 divide-y-2 divide-blush border-y-2 border-blush">
              <div className="flex items-baseline gap-4 py-5">
                <div className="min-w-0 flex-1">
                  <dt className="font-display text-2xl font-extrabold text-plum sm:text-[1.7rem]">Solar light</dt>
                  <p className="mt-1 text-[0.95rem] text-plum/70">Lights the sign at night, aimed at the busiest traffic. Add a second for both directions.</p>
                </div>
                <dd className="font-display text-4xl font-black tabular-nums text-pink-600">${PRICING.solar_lighting}</dd>
              </div>
              <div className="flex items-baseline gap-4 py-5">
                <div className="min-w-0 flex-1">
                  <dt className="font-display text-2xl font-extrabold text-plum sm:text-[1.7rem]">Brochure box</dt>
                  <p className="mt-1 text-[0.95rem] text-plum/70">
                    We supply it and install it, and it&apos;s yours to keep. Already have one? We install yours for ${PRICING.brochure_box_install}.
                  </p>
                </div>
                <dd className="font-display text-4xl font-black tabular-nums text-pink-600">${PRICING.brochure_box_purchase}</dd>
              </div>
              <div className="flex items-baseline gap-4 py-5">
                <div className="min-w-0 flex-1">
                  <dt className="font-display text-2xl font-extrabold text-plum sm:text-[1.7rem]">Riders and lockboxes</dt>
                  <dd className="sr-only">Priced on their own pages</dd>
                  <p className="mt-1 text-[0.95rem] text-plum/70">
                    On the same trip.{' '}
                    <Link href="/riders" className="font-semibold text-pink-600 underline decoration-2 underline-offset-4 hover:text-raspberry">
                      See riders
                    </Link>{' '}
                    or{' '}
                    <Link href="/lockboxes" className="font-semibold text-pink-600 underline decoration-2 underline-offset-4 hover:text-raspberry">
                      lockboxes
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </dl>
          </div>
        </div>

        {/* Agents often assume they need new signs for our posts. */}
        <div className="mx-auto mt-[clamp(3rem,7vw,5rem)] max-w-6xl px-4 sm:px-8">
          <div className="rounded-[6px] bg-blush px-5 py-6 text-center sm:px-8 md:flex md:items-center md:justify-center md:gap-8 md:text-left">
            <p className="font-display text-[clamp(1.8rem,3.2vw,2.4rem)] font-extrabold leading-none text-plum">Keep the signs you have.</p>
            <p className="mt-2 text-plum/80 md:mt-0 md:max-w-md md:text-lg">No need to order new ones. We convert your signs to hang on our posts.</p>
          </div>
        </div>
      </section>

      <ClosingCta />
      <MobileOrderBar />
      {/* Room for the phone order bar, so it never covers the footer */}
      <div aria-hidden className="h-24 bg-plum md:hidden" />
    </>
  )
}
