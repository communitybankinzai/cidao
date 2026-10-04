import { describe, expect, it } from 'vitest'
import { canRepostNow, comparableSnsContent, isSameSnsContent } from '@/lib/sns-edit-compare'

describe('isSameSnsContent', () => {
  it('カウントダウンの日数だけが違うなら同じ', () => {
    const a = '⏳ 掲載終了まであと31日（11/4まで）\n【印西応援🩰】\n本文\n\nhttps://x'
    const b = '⏳ 掲載終了まであと30日（11/4まで）\n【印西応援🩰】\n本文\n\nhttps://x'
    expect(isSameSnsContent(a, b)).toBe(true)
  })
  it('カウントダウンの有無が違うだけでも同じ', () => {
    expect(isSameSnsContent('⏳ 開催まであと3日！（10/8）\n本文', '本文')).toBe(true)
  })
  it('改行コード・行末の空白・前後の空行の違いは同じ', () => {
    expect(isSameSnsContent('本文\r\n二行目  \r\n', '\n本文\n二行目')).toBe(true)
  })
  it('本文が1文字でも違えば別', () => {
    expect(isSameSnsContent('⏳ 掲載終了まであと3日（11/4まで）\n入会金無料', '⏳ 掲載終了まであと3日（11/4まで）\n入会金半額')).toBe(false)
  })
  it('タイトル・ハッシュタグ・リンクが違えば別', () => {
    expect(isSameSnsContent('A\n#印西市', 'A\n#印西市 #FreeFree')).toBe(false)
  })
  it('文の途中にある ⏳ は消さない', () => {
    expect(comparableSnsContent('本文 ⏳ 途中\n続き')).toBe('本文 ⏳ 途中\n続き')
  })
  it('空・null同士は同じ、片方だけ空なら別', () => {
    expect(isSameSnsContent(null, '')).toBe(true)
    expect(isSameSnsContent(null, '本文')).toBe(false)
  })
})

describe('canRepostNow', () => {
  const NOW = Date.parse('2026-10-05T10:00:00Z')
  it('前回が無ければ出せる', () => {
    expect(canRepostNow(null, NOW)).toBe(true)
    expect(canRepostNow(undefined, NOW)).toBe(true)
  })
  it('24時間たっていれば出せる・たっていなければ出せない', () => {
    expect(canRepostNow('2026-10-04T10:00:00Z', NOW)).toBe(true)
    expect(canRepostNow('2026-10-04T10:00:01Z', NOW)).toBe(false)
    expect(canRepostNow('2026-10-05T09:00:00Z', NOW)).toBe(false)
  })
  it('日時が読めなければ出せる側に倒す', () => {
    expect(canRepostNow('broken', NOW)).toBe(true)
  })
})
