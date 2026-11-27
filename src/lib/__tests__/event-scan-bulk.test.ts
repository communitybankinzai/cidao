import { describe, expect, it } from 'vitest'
import { buildScanBulkNotice, checkScanBulkItems, SCAN_BULK_MAX } from '../event-scan-bulk'

const BASE = 'https://proj.supabase.co/storage/v1/object/public/event-flyers/'
const CATS = ['kodomo', 'other']
const good = {
  title: '図書館クリスマス会（小林図書館）',
  description: '大型絵本の読み聞かせなど',
  start_at: '2026-12-06T10:30',
  end_at: '2026-12-06T11:30',
  end_time_unknown: false,
  location: '小林コミュニティプラザ2階ホール',
  online_flag: false,
  capacity: 50,
  fee: 0,
  category: 'kodomo',
  organizer_name: '印西市立図書館',
  flyer_image_url: `${BASE}uid/abc.jpg`,
}

describe('checkScanBulkItems', () => {
  it('そろっている催しは、そのまま通す', () => {
    const r = checkScanBulkItems([good], BASE, CATS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.items[0]).toEqual(good)
  })

  it('何も選ばれていない・配列でないものは断る', () => {
    expect(checkScanBulkItems([], BASE, CATS).ok).toBe(false)
    expect(checkScanBulkItems('x', BASE, CATS).ok).toBe(false)
  })

  it('件数の上限を超えたら断る', () => {
    const many = Array.from({ length: SCAN_BULK_MAX + 1 }, () => good)
    expect(checkScanBulkItems(many, BASE, CATS).ok).toBe(false)
  })

  it('日時が読めていない催しは、何件目かと題名を添えて断る', () => {
    const r = checkScanBulkItems([good, { ...good, title: '日時なし', start_at: null }], BASE, CATS)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('2件目')
      expect(r.error).toContain('日時なし')
    }
  })

  it('終了時刻が未定なら、終了日時が無くても通す', () => {
    const r = checkScanBulkItems([{ ...good, end_at: null, end_time_unknown: true }], BASE, CATS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.items[0].end_time_unknown).toBe(true)
  })

  it('終了が開始より前なら断る', () => {
    expect(checkScanBulkItems([{ ...good, end_at: '2026-12-06T09:00' }], BASE, CATS).ok).toBe(false)
  })

  it('よその URL の画像は付けない（自分たちの保管場所のものだけ）', () => {
    const r = checkScanBulkItems([{ ...good, flyer_image_url: 'https://evil.example/a.jpg' }], BASE, CATS)
    expect(r.ok && r.items[0].flyer_image_url).toBeUndefined()
  })

  it('知らない分野・おかしな数は捨てる。説明が空なら題名を入れる', () => {
    const r = checkScanBulkItems([{ ...good, category: 'zzz', capacity: -1, fee: 1.5, description: '' }], BASE, CATS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.items[0].category).toBeUndefined()
      expect(r.items[0].capacity).toBeUndefined()
      expect(r.items[0].fee).toBeUndefined()
      expect(r.items[0].description).toBe(good.title)
    }
  })
})

describe('buildScanBulkNotice', () => {
  it('1件のときは、ふつうの新着と同じ題名', () => {
    expect(buildScanBulkNotice(['夏まつり']).title).toBe('新しいイベント「夏まつり」が登録されました')
  })
  it('複数のときは件数を題名に、題名を本文に（4件目からは「ほか」）', () => {
    const n = buildScanBulkNotice(['A', 'B', 'C', 'D', 'E'])
    expect(n.title).toBe('新しいイベントが5件登録されました')
    expect(n.body).toBe('「A」「B」「C」 ほか2件')
  })
})
