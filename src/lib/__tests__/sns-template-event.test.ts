import { describe, it, expect } from 'vitest'
import { generateSnsContent } from '../sns-template'

const target = {
  target_type: 'event' as const,
  target_id: 'e1',
  title: '秋のまちあるきイベント',
  body: 'かんたんな説明',
  location: '印西市役所',
  start_at: '2026-11-03T01:00:00Z',
  organizer_name: '印西まちづくりの会',
}

describe('イベント紹介の本文', () => {
  it('Threads は協力団体・企業向けのCiDAO登録導線で終わり、500字以内', () => {
    const t = generateSnsContent(target, 'threads')
    expect(t).toContain('/events/e1')
    expect(t).toContain('/login')
    expect(t).toContain('協力してくださる印西市民の方・団体・企業')
    expect(t.length).toBeLessThanOrEqual(500)
  })
  it('Instagram はURLを載せずプロフィールのリンクへ誘導する', () => {
    const t = generateSnsContent(target, 'instagram')
    expect(t).toContain('プロフィールのリンク')
    expect(t).not.toContain('http')
  })
})
