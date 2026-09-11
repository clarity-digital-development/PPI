/**
 * Install-location photo compression.
 *
 * Agents upload straight off an iPhone, so a single "here's where the post
 * goes" picture routinely lands at 4–5 MB. Two things broke because of that
 * (Ryan, 2026-09-08): the installer dispatch email hit its 3 MB per-photo cap
 * and printed "photo too large to attach — see the admin order page", and the
 * admin order page had to inline a multi-megabyte data URI on every load.
 *
 * Everything here is best-effort: a failure NEVER loses the customer's photo,
 * it just returns the original bytes. Callers can treat this as a pure
 * "make it smaller if you can" pass.
 */
import sharp from 'sharp'

// Below this we don't bother — re-encoding a small photo costs CPU and can
// make it bigger.
const SKIP_UNDER_BYTES = 500 * 1024

// Target for a compressed photo. Comfortably under the dispatch email's
// per-photo cap with room for a dozen jobs in one send.
const TARGET_BYTES = 900 * 1024

// Quality/size ladder. Each rung is tried in order until one lands under
// TARGET_BYTES; the last rung is used as-is if none do.
const LADDER: Array<{ maxEdge: number; quality: number }> = [
  { maxEdge: 1600, quality: 78 },
  { maxEdge: 1400, quality: 70 },
  { maxEdge: 1100, quality: 62 },
]

export type CompressedPhoto = { content: Buffer; ext: 'jpg' }

/**
 * Compress raw image bytes to a JPEG small enough to email.
 * Returns null when the input is already small enough or can't be decoded —
 * in both cases the caller should keep what it already had.
 */
export async function compressPhotoBytes(input: Buffer): Promise<CompressedPhoto | null> {
  if (input.length <= SKIP_UNDER_BYTES) return null

  for (const rung of LADDER) {
    try {
      // limitInputPixels caps the DECODED bitmap, which is what actually
      // allocates: a 5 MB upload can be a 78 MP image that expands to ~900 MB
      // of RGB and takes the container down. sharp rejects from the header in
      // about a millisecond, and the catch below turns that into "keep the
      // original", which is the same as any other failure here.
      const out = await sharp(input, { failOn: 'none', limitInputPixels: 40_000_000 })
        // .rotate() with no argument applies the EXIF orientation and then
        // drops the tag. Without it, stripping metadata leaves iPhone photos
        // lying on their side in the email.
        .rotate()
        .resize({ width: rung.maxEdge, height: rung.maxEdge, fit: 'inside', withoutEnlargement: true })
        // JPEG has no alpha channel, and sharp composites transparency against
        // BLACK. An annotated screenshot saved as a transparent PNG would come
        // back with solid black blotches — and since this result is what gets
        // STORED, the original would be gone. Byte-identical no-op on the
        // opaque phone photos that are the normal case.
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: rung.quality, mozjpeg: true })
        .toBuffer()
      // Never hand back something larger than what we were given.
      if (out.length >= input.length) return null
      if (out.length <= TARGET_BYTES || rung === LADDER[LADDER.length - 1]) {
        return { content: out, ext: 'jpg' }
      }
    } catch (err) {
      console.error('[photo-compress] failed to re-encode image:', err)
      return null
    }
  }
  return null
}

const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i

// Image sub-types we are willing to pass through UNCOMPRESSED (i.e. attach as
// the original bytes). Deliberately excludes svg+xml — see below.
const RASTER_EXT: Record<string, string> = {
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  heic: 'heic',
  heif: 'heif',
  bmp: 'bmp',
}

/**
 * Decode a `data:image/...;base64,...` string and shrink it in one step, ready
 * to hand to an email attachment. Returns null when there's nothing usable.
 */
export async function decodeAndCompressDataUri(
  uri: string | null | undefined,
  opts: { maxBytes: number }
): Promise<{ filename: string; content: Buffer } | null> {
  if (typeof uri !== 'string' || !uri) return null
  const m = DATA_URI_RE.exec(uri.trim())
  if (!m) return null
  let raw: Buffer
  try {
    raw = Buffer.from(m[2], 'base64')
  } catch {
    return null
  }
  if (!raw.length) return null
  const sub = m[1].slice('image/'.length).toLowerCase()
  const ext = RASTER_EXT[sub]
  const smaller = await compressPhotoBytes(raw)
  // Only ever hand the mailer a raster we recognise. Compression is skipped
  // for anything small, so without this an SVG would be forwarded byte for
  // byte — and an SVG is an active document: a <script> inside one supplied
  // by a customer runs when the attachment is previewed.
  if (!smaller && !ext) return null
  const content = smaller ? smaller.content : raw
  if (content.length > opts.maxBytes) return null
  return { filename: `location.${smaller ? smaller.ext : ext}`, content }
}

/**
 * Compress a `data:image/...;base64,...` string in place. Returns the input
 * unchanged whenever it isn't a data URI we can shrink, so this is safe to
 * drop straight into a Prisma `data: {}` block.
 */
export async function compressImageDataUri(uri: string | null | undefined): Promise<string | null | undefined> {
  // typeof, not just falsy: the batch route has no zod schema, so a client can
  // post a number or an object here and `.trim()` would throw out of a helper
  // whose whole contract is that it never does.
  if (typeof uri !== 'string' || !uri) return uri
  const m = DATA_URI_RE.exec(uri.trim())
  if (!m) return uri
  let raw: Buffer
  try {
    raw = Buffer.from(m[2], 'base64')
  } catch {
    return uri
  }
  const smaller = await compressPhotoBytes(raw)
  if (!smaller) return uri
  return `data:image/jpeg;base64,${smaller.content.toString('base64')}`
}
