import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { encodeRoadImage, MAX_ROAD_IMAGE_OUTPUT_BYTES, normalizeRoadMediaUrls } from '@/lib/disaster-road-media'

const db = vi.hoisted(() => ({
  response: { data: null as unknown, error: null as unknown },
  update: vi.fn(), upload: vi.fn(), from: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  from: (table: string) => {
    db.from(table)
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      update: (values: unknown) => { db.update(values); return chain },
      maybeSingle: async () => db.response,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(db.response).then(resolve),
    }
    return chain
  },
  storage: { from: () => ({ upload: db.upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }) }) },
}) }))
vi.mock('@/lib/disaster-amedas-rain', () => ({ distanceM: () => 0, rainAt: vi.fn() }))

import { GET, PATCH } from '@/app/api/disaster/passed-roads/route'
import { POST as uploadImage, OPTIONS } from '@/app/api/disaster/passed-roads/image/route'

const ID = '12345678-1234-1234-1234-123456789abc'
const KEY = 'moderation-key-for-tests'
const ORIGIN = 'https://communitybankinzai.github.io'
const patch = (body: unknown, key = KEY) => PATCH(new Request(`https://example.test/api/disaster/passed-roads?id=${ID}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-moderation-key': key }, body: JSON.stringify(body),
}))
const upload = (image: Blob, key = KEY, id = ID) => {
  const form = new FormData()
  form.append('roadId', id)
  form.append('image', image, 'original.png')
  return uploadImage(new Request('https://example.test/api/disaster/passed-roads/image', {
    method: 'POST', headers: { 'x-moderation-key': key, Origin: ORIGIN }, body: form,
  }))
}

beforeEach(() => {
  vi.stubEnv('DISASTER_MODERATION_KEY', KEY)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
  db.response = { data: [{ id: ID }], error: null }
  db.upload.mockResolvedValue({ error: null })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('road attachment URLs', () => {
  it('accepts HTTP(S), normalizes and deduplicates without fetching', () => {
    expect(normalizeRoadMediaUrls([' https://example.com/photo.jpg ', 'https://example.com/photo.jpg', 'http://example.org/post']))
      .toEqual(['https://example.com/photo.jpg', 'http://example.org/post'])
  })
  it.each([null, 'https://example.com', ['javascript:alert(1)'], ['data:image/png;base64,aaa'], ['//example.com/a'],
    ['https://u:p@example.com/a'], ['https://example.com/\nfoo'], [23], Array(4).fill('https://example.com/a'), ['https://example.com/' + 'a'.repeat(2048)]])('rejects invalid value %j', (value) => {
    expect(normalizeRoadMediaUrls(value)).toBeNull()
  })
})

describe('road edits and public responses', () => {
  it('adds both arrays, including explicit empty array to clear images', async () => {
    const response = await patch({ imageUrls: [], sourceUrls: ['https://example.com/post'] })
    expect(response.status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ image_urls: [], source_urls: ['https://example.com/post'] })
    expect(await response.json()).toMatchObject({ imageUrls: [], sourceUrls: ['https://example.com/post'] })
  })
  it('preserves attachments when only a note changes', async () => {
    expect((await patch({ note: '  通れました  ' })).status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ note: '通れました' })
  })
  it('refuses unauthenticated edits before writing', async () => {
    expect((await patch({ imageUrls: [] }, 'wrong')).status).toBe(403)
    expect(db.update).not.toHaveBeenCalled()
  })
  it('rejects unsafe URLs and null payloads without writing', async () => {
    expect((await patch({ sourceUrls: ['javascript:alert(1)'] })).status).toBe(400)
    expect((await patch(null)).status).toBe(400)
    expect(db.update).not.toHaveBeenCalled()
  })
  it('reports nonexistent record instead of success', async () => {
    db.response.data = []
    expect((await patch({ imageUrls: [] })).status).toBe(404)
  })
  it.each(['json', 'geojson'])('returns image/source URLs in %s', async (format) => {
    db.response.data = [{ id: ID, kind: 'blocked', path: [[35.8, 140.1]], image_urls: ['https://example.com/a.jpg'], source_urls: ['https://example.com/post'] }]
    const response = await GET(new Request(`https://example.test/api/disaster/passed-roads?format=${format}`))
    const data = await response.json()
    const record = format === 'json' ? data.roads[0] : data.features[0].properties
    expect(record).toMatchObject({ imageUrls: ['https://example.com/a.jpg'], sourceUrls: ['https://example.com/post'] })
  })
})

describe('raster image upload', () => {
  it('re-encodes PNG as capped JPEG and removes metadata', async () => {
    const input = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#4488aa' } }).png().withMetadata().toBuffer()
    const result = await encodeRoadImage(input)
    const meta = await sharp(result).metadata()
    expect(meta).toMatchObject({ format: 'jpeg', width: 1600, height: 800 })
    expect(meta.exif).toBeUndefined()
    expect(meta.icc).toBeUndefined()
    expect(result.length).toBeLessThanOrEqual(MAX_ROAD_IMAGE_OUTPUT_BYTES)
  })
  it('refuses SVG and non-image content', async () => {
    await expect(encodeRoadImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'))).rejects.toThrow()
    await expect(encodeRoadImage(Buffer.from('not an image'))).rejects.toThrow()
  })
  it('uploads JPEG to a random object path and returns its URL without changing the road', async () => {
    db.response.data = { id: ID }
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).png().toBuffer()
    const response = await upload(new Blob([new Uint8Array(png)], { type: 'image/png' }))
    expect(response.status).toBe(201)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(db.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${ID}/[0-9a-f-]+\\.jpg$`)), expect.any(Buffer), expect.objectContaining({ contentType: 'image/jpeg', upsert: false }))
    expect(await response.json()).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/storage.example\//) })
    expect(db.update).not.toHaveBeenCalled()
  })
  it('refuses unauthorized upload, unknown road, and invalid data', async () => {
    const image = new Blob(['not image'], { type: 'image/jpeg' })
    expect((await upload(image, 'wrong')).status).toBe(403)
    db.response.data = null
    expect((await upload(image)).status).toBe(404)
    db.response.data = { id: ID }
    expect((await upload(image)).status).toBe(400)
    expect(db.upload).not.toHaveBeenCalled()
  })
  it('rejects oversized input without trusting content-length', async () => {
    const response = await upload(new Blob([new Uint8Array(8 * 1024 * 1024 + 70 * 1024)]))
    expect(response.status).toBe(413)
    expect(db.upload).not.toHaveBeenCalled()
  })
  it('allows preflight with moderator header', () => {
    const response = OPTIONS(new Request('https://example.test', { headers: { Origin: ORIGIN } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-moderation-key')
  })
})
