/**
 * Shrink an install-location photo in the browser before it's sent.
 *
 * The photo travels as a data URI inside the order's JSON body, and Vercel
 * refuses any request over 4.5 MB before our code runs. An iPhone photo is
 * 4–5 MB (about 6.7 MB as a data URI), and a cart checkout carries one per
 * order, so it's downscaled here to roughly 150–300 KB. The server still runs
 * lib/images/compress.ts, which skips anything this small.
 */

const MAX_EDGE = 1280
const QUALITY = 0.72

// What we'll send as-is if the browser can't decode the file (an unusual
// format): small enough that a few of them still fit in one request.
export const MAX_UNCOMPRESSED_BYTES = 1.5 * 1024 * 1024

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void }

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function viaBitmap(file: File, options?: ImageBitmapOptions): Promise<Decoded> {
  const bitmap = options ? await createImageBitmap(file, options) : await createImageBitmap(file)
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
}

// <img> applies the EXIF rotation itself on current iOS and Chrome.
async function viaImg(file: File): Promise<Decoded> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

// Older Safari and Chrome reject the imageOrientation option outright, so
// each decoder is tried in turn; 'from-image' keeps phone photos upright.
async function decode(file: File): Promise<Decoded> {
  const attempts: Array<() => Promise<Decoded>> = []
  if (typeof createImageBitmap === 'function') {
    attempts.push(() => viaBitmap(file, { imageOrientation: 'from-image' }), () => viaBitmap(file))
  }
  attempts.push(() => viaImg(file))
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

/**
 * Returns a JPEG data URI no larger than MAX_EDGE on its long side, or the
 * original file as a data URI when it can't be decoded and is already under
 * MAX_UNCOMPRESSED_BYTES. Returns null when it can't be made small enough.
 */
export async function compressPhotoForUpload(file: File): Promise<string | null> {
  try {
    const decoded = await decode(file)
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height))
      const width = Math.round(decoded.width * scale)
      const height = Math.round(decoded.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      // JPEG has no transparency: paint white first so a transparent PNG
      // doesn't come out with black patches.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(decoded.source, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
      if (!blob) throw new Error('toBlob failed')
      return await readAsDataUrl(blob)
    } finally {
      decoded.release()
    }
  } catch {
    if (file.size > MAX_UNCOMPRESSED_BYTES) return null
    return readAsDataUrl(file)
  }
}
