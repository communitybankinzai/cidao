// 市の避難情報（高齢者等避難・避難指示・緊急安全確保）の発令と解除の判定。
// 放送文は 2026-09-21〜22 に印西市防災速報で実際に出た文面を縮めたもの。

import { describe, expect, it } from 'vitest'
import { detectEvacAlerts, parsePublishedAt } from '@/lib/inzai-evac-alert'
import type { OfficialUpdate } from '@/lib/inzai-city-alerts'

const update = (publishedAt: string, message: string, title = '防災情報'): OfficialUpdate => ({
  title, message, publishedAt, sourceUrl: 'https://www.city.inzai.lg.jp/bousaiinzai/test',
})

const DOSHA = update('2026/09/21 14:30:00', '大雨により土砂災害の危険性が高まったため、土砂災害警戒区域および土砂災害のおそれがある箇所に対し、避難指示を発令しました。')
const INBANUMA = update('2026/09/21 17:35:00', '印旛沼の水位が上昇していることから、印旛沼周辺の低い土地にお住いの方に対し、避難指示を発令しました。')
const hoursAfter = (u: OfficialUpdate, hours: number) => parsePublishedAt(u.publishedAt) + hours * 3600_000

describe('detectEvacAlerts：解除', () => {
  it('土砂の解除放送は土砂の発令だけを外し、印旛沼の発令は残す', () => {
    // 土砂災害警戒区域の避難指示を解除しても、印旛沼の避難指示は出たまま
    const cancel = update('2026/09/22 07:00:00', '土砂災害警戒区域に発令していた避難指示を解除しました。')
    const { alerts, reason } = detectEvacAlerts([DOSHA, INBANUMA, cancel], hoursAfter(cancel, 1))
    expect(reason).toBe('active')
    expect(alerts.map((a) => a.area)).toEqual(['印旛沼周辺の低い土地'])
  })

  it('災害の種類・場所の語が無い解除放送は、それ以前の発令をすべて外す', () => {
    // 「すべての避難指示を解除」は土砂・印旛沼どちらの語も含まない → 両方とも外れる
    const cancel = update('2026/09/22 12:00:00', 'すべての避難指示を解除しました。')
    const { alerts, reason } = detectEvacAlerts([DOSHA, INBANUMA, cancel], hoursAfter(cancel, 1))
    expect(alerts).toEqual([])
    expect(reason).toBe('cancelled')
  })

  it('「避難指示を解除し、高齢者等避難を発令」は避難指示を外し、高齢者等避難を残す', () => {
    // 同じ文に解除と発令が並ぶとき、解除した部分を除いた残り（高齢者等避難）を新しい発令と数える
    const change = update('2026/09/22 09:00:00', '印旛沼周辺の避難指示を解除し、高齢者等避難を発令しました。')
    const { alerts } = detectEvacAlerts([INBANUMA, change], hoursAfter(change, 1))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ level: 3, label: '高齢者等避難', publishedAt: '2026/09/22 09:00:00' })
  })
})

describe('detectEvacAlerts：期限切れ', () => {
  // 依頼では「24時間」だったが、実装は 2026-09-22 に7日（EXPIRE_HOURS = 24 * 7）へ変わっている。実装に合わせて確かめる
  it('発令から24時間を過ぎても、解除の放送が無ければ残す', () => {
    // 9/21 の印旛沼の避難指示が、解除されないまま翌日の同時刻に消えた不具合（2026-09-22）が再発しないこと
    const { alerts, reason } = detectEvacAlerts([INBANUMA], hoursAfter(INBANUMA, 25))
    expect(reason).toBe('active')
    expect(alerts).toHaveLength(1)
  })

  it('発令から7日を過ぎたものは外す（reason は expired）', () => {
    // 解除の文面を読み落としても、7日で帯から消えること
    expect(detectEvacAlerts([INBANUMA], hoursAfter(INBANUMA, 24 * 7)).alerts).toHaveLength(1)
    const { alerts, reason } = detectEvacAlerts([INBANUMA], hoursAfter(INBANUMA, 24 * 7 + 1))
    expect(alerts).toEqual([])
    expect(reason).toBe('expired')
  })
})

describe('detectEvacAlerts：対象地域の読み取り', () => {
  it('「印旛沼周辺の低い土地にお住いの方に対し」→「印旛沼周辺の低い土地」', () => {
    // 「〜にお住いの方」を落として、場所の部分だけを帯に出す
    expect(detectEvacAlerts([INBANUMA], hoursAfter(INBANUMA, 1)).alerts[0].area).toBe('印旛沼周辺の低い土地')
  })

  it('「土砂災害警戒区域および土砂災害のおそれがある箇所に対し」→そのまま', () => {
    // 「〜の方」が付かない書き方は、読点の後から「に対し」の前までをそのまま使う
    expect(detectEvacAlerts([DOSHA], hoursAfter(DOSHA, 1)).alerts[0].area).toBe('土砂災害警戒区域および土砂災害のおそれがある箇所')
  })
})
