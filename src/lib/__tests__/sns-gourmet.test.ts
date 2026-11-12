// 食レポマップの SNS 紹介文（2026-11-12）
import { describe, expect, it } from 'vitest'
import { generateSnsContent, gourmetShopUrl } from '@/lib/sns-template'
import { gourmetSnsTarget, type GourmetReportForSns } from '@/lib/sns-target'

const base: GourmetReportForSns = {
  id: '11111111-2222-3333-4444-555555555555',
  shop_ref: 'osm:n4418406387',
  shop_name: 'みろべラーメン',
  url: 'https://www.instagram.com/p/ABCdef123/',
  platform: 'instagram',
  author_handle: 'sample_user',
  is_own: true,
  comment: '煮干しのスープが最高でした',
  hidden: false,
  sns_ok: true,
}

describe('食レポの SNS 紹介文', () => {
  it('自分の投稿なら @名前 で呼び、元の投稿と地図のリンクを載せる', () => {
    const t = generateSnsContent(gourmetSnsTarget(base), 'threads')
    expect(t).toContain('@sample_user さんのInstagramの投稿')
    expect(t).toContain(base.url)
    expect(t).toContain('gourmet-map/?shop=osm%3An4418406387')
    expect(t).toContain('「煮干しのスープが最高でした」')
    expect(t.length).toBeLessThanOrEqual(500)
  })

  it('他人の投稿を紹介した食レポでは @名前 を出さない（紹介した人の同意は本人の同意ではない）', () => {
    const t = generateSnsContent(gourmetSnsTarget({ ...base, is_own: false }), 'threads')
    expect(t).not.toContain('@sample_user')
    expect(t).toContain('（見つけた人が紹介）')
  })

  it('食レポマップは CBI のサイトなので utm を付けない', () => {
    expect(gourmetShopUrl('osm:n1')).toBe('https://communitybankinzai.github.io/cbi-site/gourmet-map/?shop=osm%3An1')
    const t = generateSnsContent(gourmetSnsTarget(base), 'facebook')
    expect(t).not.toContain('utm_')
  })

  it('Instagram は押せない URL を載せず、検索の言葉で地図へ誘う', () => {
    const t = generateSnsContent(gourmetSnsTarget(base), 'instagram')
    expect(t).not.toMatch(/https?:\/\//)
    expect(t).toContain('「印西 食レポマップ」で検索')
  })

  it('店名・ひとことが長くても Threads の500字に収まる', () => {
    const t = generateSnsContent(gourmetSnsTarget({ ...base, shop_name: 'あ'.repeat(60), comment: 'い'.repeat(100) }), 'threads')
    expect(t.length).toBeLessThanOrEqual(500)
  })
})
