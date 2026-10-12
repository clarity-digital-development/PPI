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

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Returns a JPEG data URI no larger than MAX_EDGE on its long side, or the
 * original file as a data URI when it can't be decoded and is already under
 * MAX_UNCOMPRESSED_BYTES. Returns null when it can't be made small enough.
 */
export async function compressPhotoForUpload(file: File): Promise<string | null> {
  try {
    // from-image applies the EXIF rotation, so phone photos aren't sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    // JPEG has no transparency: paint white first so a transparent PNG
    // doesn't come out with black patches.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob) throw new Error('toBlob failed')
    return await readAsDataUrl(blob)
  } catch {
    if (file.size > MAX_UNCOMPRESSED_BYTES) return null
    return readAsDataUrl(file)
  }
}
