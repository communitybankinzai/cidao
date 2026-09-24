import sharp from 'sharp'

export const ROAD_IMAGE_BUCKET = 'disaster-road-images'
export const MAX_ROAD_MEDIA = 3
export const MAX_ROAD_IMAGE_INPUT_BYTES = 8 * 1024 * 1024
export const MAX_ROAD_IMAGE_OUTPUT_BYTES = 1024 * 1024

// URLs are displayed as links/images only; the server never fetches user URLs.
export function normalizeRoadMediaUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ROAD_MEDIA) return null
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 2048 || /[\u0000-\u001f\u007f]/.test(item)) return null
    const text = item.trim()
    if (!/^https?:\/\//i.test(text)) return null
    try {
      const url = new URL(text)
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
      if (!result.includes(url.href)) result.push(url.href)
    } catch { return null }
  }
  return result
}

export async function encodeRoadImage(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_ROAD_IMAGE_INPUT_BYTES) throw new Error('image_too_large')
  // A raster decoder, a pixel ceiling, and re-encoding prevent SVG/script and EXIF uploads.
  const options = { limitInputPixels: 40_000_000, animated: false }
  const metadata = await sharp(input, options).metadata()
  if (!metadata.format || !['jpeg', 'png', 'webp', 'gif', 'heif', 'avif'].includes(metadata.format)) {
    throw new Error('invalid_image')
  }
  for (const quality of [82, 65, 45]) {
    const output = await sharp(input, options).rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    if (output.length <= MAX_ROAD_IMAGE_OUTPUT_BYTES) return output
  }
  throw new Error('image_too_large')
}
