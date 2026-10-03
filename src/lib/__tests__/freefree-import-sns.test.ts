import { test, expect } from 'vitest'
import { generateSnsContent, generateImportSnsContent, type SnsTarget, type SnsMedium } from '../sns-template'
import { introOfBody, remainingDailyCap, SNS_DAILY_CAP_DEFAULT, GSI_TILE_URL } from '../freefree-import-core'

const base: SnsTarget = {
  target_type: 'freefree', target_id: 'abc-123', title: '木まぐれKopitiam', category: 'food',
  location: '千葉県印西市武西1205-49',
  body: '🏷 種別：飲食店\n📍 所在地：千葉県印西市武西1205-49\n\n※この掲載は、公開データ…',
  poster_name: 'ある運営者', import_source: 'openpoi', has_map: true, end_date: '2027-01-03',
}
const media: SnsMedium[] = ['threads', 'facebook', 'instagram', 'x', 'line']

test('取込掲載のSNS文: お店の方への呼びかけ。応援表明・カウントダウン・掲載者名は入れない', () => {
  for (const m of media) {
    const t = generateSnsContent(base, m)
    expect(t).toContain('お店の方へ')
    expect(t).toContain('木まぐれKopitiam')
    expect(t).not.toContain('CBIは')
    expect(t).not.toContain('応援しています')
    expect(t).not.toContain('あと')
    expect(t).not.toContain('ある運営者')
  }
})

test('取込掲載のSNS文: 評価の言葉を含まない・エリアが入る', () => {
  const t = generateImportSnsContent(base, 'threads')
  expect(t).toContain('印西市武西')
  for (const w of ['人気', 'おいしい', 'おすすめ', '老舗', '口コミ']) expect(t).not.toContain(w)
})

test('取込掲載のSNS文: 地図があるときだけ国土地理院の出典を添える', () => {
  expect(generateImportSnsContent(base, 'threads')).toContain('国土地理院')
  expect(generateImportSnsContent(base, 'threads')).toContain(GSI_TILE_URL)
  expect(generateImportSnsContent(base, 'instagram')).toContain('国土地理院')
  expect(generateImportSnsContent({ ...base, has_map: false }, 'threads')).not.toContain('国土地理院')
})

test('取込掲載のSNS文: Threadsは500字以内（店名が最長でも）・Instagramはプロフィール誘導', () => {
  const long = { ...base, title: 'あ'.repeat(60), body: 'い'.repeat(300) + '\n\n🏷 種別：飲食店' }
  expect(generateImportSnsContent(long, 'threads').length).toBeLessThanOrEqual(500)
  const ig = generateImportSnsContent(base, 'instagram')
  expect(ig).toContain('プロフィールのリンク')
  expect(ig).not.toContain('https://cidao.vercel.app/freefree/abc-123')
  expect(generateImportSnsContent(long, 'x').length).toBeLessThan(200)
})

test('取込掲載のSNS文: 運営の紹介文があれば入れる。定型の行だけなら入れない', () => {
  const withIntro = { ...base, body: 'マレーシア料理のお店です。\n\n🏷 種別：飲食店' }
  expect(generateImportSnsContent(withIntro, 'threads')).toContain('マレーシア料理のお店です。')
  expect(generateImportSnsContent(base, 'threads')).not.toContain('種別')
  expect(introOfBody(withIntro.body)).toBe('マレーシア料理のお店です。')
  expect(introOfBody(base.body)).toBe(null)
  expect(introOfBody('')).toBe(null)
})

test('取込掲載でない掲載の文面は従来どおり（応援表明つき）', () => {
  const normal: SnsTarget = { ...base, import_source: null, poster_name: 'ABC工房' }
  expect(generateSnsContent(normal, 'threads')).toContain('CBIは、ABC工房さんの地域での活動を応援しています')
})

test('1日の上限: 残りの件数', () => {
  expect(SNS_DAILY_CAP_DEFAULT).toBe(3)
  expect(remainingDailyCap(3, 0)).toBe(3)
  expect(remainingDailyCap(3, 2)).toBe(1)
  expect(remainingDailyCap(3, 3)).toBe(0)
  expect(remainingDailyCap(3, 9)).toBe(0)
  expect(remainingDailyCap(-1, 0)).toBe(3)
  expect(remainingDailyCap(NaN, 1)).toBe(2)
})
