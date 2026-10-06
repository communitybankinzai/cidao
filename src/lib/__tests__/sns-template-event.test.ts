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
    expect(t.startsWith('イベント告知は、毎朝、その日開催の分をまとめて行っています。主催者から依頼があった場合は、当日以外にも単独でのイベント告知に協力しています。')).toBe(true)
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

describe('イベント紹介の本文（自由入力が長い場合）', () => {
  it('タイトル・場所・主催者名・説明が長くても Threads の500字に収まり、登録導線が残る', () => {
    const long = 'あ'.repeat(300)
    const t = generateSnsContent(
      { ...target, title: long, location: long, organizer_name: long, body: long },
      'threads',
    )
    expect(t.length).toBeLessThanOrEqual(500)
    expect(t).toContain('/login')
  })
})
