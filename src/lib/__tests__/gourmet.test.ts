import { describe, expect, it } from 'vitest'
import { insideGourmetArea, normalizeHandle, normalizeText, parseShopRef, parseSnsUrl } from '@/lib/gourmet'

describe('parseSnsUrl', () => {
  it('Instagram の投稿は追跡用のパラメータを落として受ける', () => {
    const r = parseSnsUrl('https://www.instagram.com/p/ABC123xyz/?igsh=MWM5amJ4&utm_source=ig_web')
    expect(r).toEqual({ url: 'https://www.instagram.com/p/ABC123xyz/', platform: 'instagram', platformLabel: 'Instagram', handle: null })
  })
  it('URL に投稿者名があれば読む（X・Threads・TikTok・Bluesky・Instagram の新しい形）', () => {
    expect(parseSnsUrl('https://x.com/inzai_gourmet/status/1234567890')?.handle).toBe('inzai_gourmet')
    expect(parseSnsUrl('https://twitter.com/foo_bar/status/1')?.platform).toBe('x')
    expect(parseSnsUrl('https://www.threads.com/@ramen.lover/post/DABC')?.handle).toBe('ramen.lover')
    expect(parseSnsUrl('https://www.tiktok.com/@eat.inzai/video/7300000000')?.handle).toBe('eat.inzai')
    expect(parseSnsUrl('https://bsky.app/profile/food.bsky.social/post/3kxyz')?.handle).toBe('food.bsky.social')
    expect(parseSnsUrl('https://www.instagram.com/cafe_lover/p/ABC123/')?.handle).toBe('cafe_lover')
  })
  it('YouTube は v だけ残す', () => {
    expect(parseSnsUrl('https://www.youtube.com/watch?v=abc123&t=30s&si=x')?.url).toBe('https://www.youtube.com/watch?v=abc123')
  })
  it('SNS・ブログ以外、http、プロフィールだけ、空白入りは受けない', () => {
    expect(parseSnsUrl('https://example.com/post/1')).toBeNull()
    expect(parseSnsUrl('http://www.instagram.com/p/ABC/')).toBeNull()
    expect(parseSnsUrl('https://www.instagram.com/')).toBeNull()
    expect(parseSnsUrl('https://instagram.com.evil.example/p/ABC/')).toBeNull()
    expect(parseSnsUrl('https://x.com/a/status/1 2')).toBeNull()
    expect(parseSnsUrl('javascript:alert(1)')).toBeNull()
    expect(parseSnsUrl(123)).toBeNull()
  })
})

describe('入力の整え方', () => {
  it('投稿者名は @ を外し、使えない文字があれば undefined', () => {
    expect(normalizeHandle('@abc_1')).toBe('abc_1')
    expect(normalizeHandle('')).toBeNull()
    expect(normalizeHandle('あいう')).toBeUndefined()
  })
  it('短い文は空白をまとめ、長すぎれば undefined', () => {
    expect(normalizeText('  おいしい   ラーメン ', 100)).toBe('おいしい ラーメン')
    expect(normalizeText('あ'.repeat(101), 100)).toBeUndefined()
    expect(normalizeText('', 100)).toBeNull()
  })
  it('範囲は印西市と周辺だけ', () => {
    expect(insideGourmetArea(35.8, 140.15)).toBe(true)
    expect(insideGourmetArea(35.68, 139.76)).toBe(false) // 東京駅
  })
  it('お店の参照は osm・poi・shop・ff の4種類', () => {
    expect(parseShopRef('osm:n123')).toEqual({ kind: 'osm', ref: 'osm:n123', id: 'n123' })
    expect(parseShopRef('poi:0123abcd4567')).toEqual({ kind: 'poi', ref: 'poi:0123abcd4567', id: '0123abcd4567' })
    expect(parseShopRef('POI:0123ABCD4567')?.ref).toBe('poi:0123abcd4567')
    expect(parseShopRef('poi:0123abcd456')).toBeNull()
    expect(parseShopRef('poi:0123abcd4567g')).toBeNull()
    expect(parseShopRef('shop:6f9619ff-8b86-d011-b42d-00c04fc964ff')?.kind).toBe('shop')
    expect(parseShopRef('ff:6F9619FF-8B86-D011-B42D-00C04FC964FF')?.id).toBe('6f9619ff-8b86-d011-b42d-00c04fc964ff')
    expect(parseShopRef('osm:x1')).toBeNull()
    expect(parseShopRef('shop:abc')).toBeNull()
  })
})
