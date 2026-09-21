// 自動投稿の引用ブロックのテスト。
// 気象庁の警報・注意報は同じ本文のまま何度も更新されるため、同じ引用が並びやすい。

import { describe, expect, it } from 'vitest'
import { buildText, type Signal } from '@/lib/disaster-auto-post'

const WARN_BODY = '北西部、北東部では、低い土地の浸水や河川の増水に厳重に警戒してください。'

function signal(over: Partial<Signal> = {}): Signal {
  return {
    level: 3,
    title: '印西市：レベル3大雨警報（継続）',
    body: WARN_BODY,
    source: '気象庁 印西市の警報・注意報',
    occurredAt: '2026-09-21T12:52:00+09:00',
    ...over,
  }
}

describe('buildText', () => {
  it('同じ情報源の同じ本文は1回しか引用しない', () => {
    const text = buildText([signal(), signal({ occurredAt: '2026-09-21T12:45:00+09:00' })], 3)
    const count = text.split(WARN_BODY).length - 1
    expect(count).toBe(1)
    expect(text.split('■ 気象庁 印西市の警報・注意報より').length - 1).toBe(1)
  })

  it('中身が違えば2件まで引用する', () => {
    const other = '土砂災害に厳重に警戒してください。'
    const text = buildText([
      signal(),
      signal({ body: other, title: '印西市：レベル3土砂災害警戒情報' }),
    ], 3)
    expect(text).toContain(WARN_BODY)
    expect(text).toContain(other)
  })

  it('3件以上あっても引用は2件まで', () => {
    const text = buildText([
      signal({ body: 'A の本文' }),
      signal({ body: 'B の本文' }),
      signal({ body: 'C の本文' }),
    ], 3)
    expect(text).toContain('A の本文')
    expect(text).toContain('B の本文')
    expect(text).not.toContain('C の本文')
  })

  it('警戒レベル3の説明と出典の案内は残る', () => {
    const text = buildText([signal()], 3)
    expect(text).toContain('警戒レベル3相当は')
    expect(text).toContain('最新の状況は必ず公式発信でご確認ください。')
  })
})
