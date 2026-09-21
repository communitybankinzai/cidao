// 自動投稿の「出すかどうか」の判定テスト。
// 2026-09-21 の台風25号で、同じような投稿が1日8回（うち解除2回）出た流れを再現する。

import { describe, expect, it } from 'vitest'
import { decideAutoPost, DROP_CONFIRM_MINUTES, type AutoPostState } from '@/lib/disaster-auto-post'

const CONFIG = { autoLevel: 3, approvalLevel: 3, minIntervalMinutes: 180 }
const t = (hhmm: string) => Date.parse(`2026-09-21T${hhmm}:00+09:00`)
const EMPTY: AutoPostState = { level: 0, hash: '', updatedAt: new Date(0).toISOString() }

/** 1回分の巡回を回し、投稿したら lastPosted* を記録する（runAutoPost と同じ扱い） */
function tick(state: AutoPostState, at: string, level: number, hash = `h${level}`) {
  const d = decideAutoPost(state, level, hash, CONFIG, t(at))
  let next = d.state
  if (d.action === 'post') {
    next = { ...next, lastPostedAt: new Date(t(at)).toISOString(), lastPostedLevel: level }
  }
  return { action: d.action, state: next }
}

describe('decideAutoPost', () => {
  it('2026-09-21 の流れで、投稿は8回から3回に減る', () => {
    const log: string[] = []
    let s = EMPTY
    const run = (at: string, level: number, hash?: string) => {
      const r = tick(s, at, level, hash)
      s = r.state
      if (r.action === 'post' || r.action === 'cancel') log.push(`${at} ${r.action}`)
    }

    run('03:00', 3, 'a')      // 大雨警報 → 投稿
    run('05:00', 0)           // 下がった → 30分待つ
    run('05:10', 0)
    run('05:30', 0)           // 30分続いた → 解除を知らせる
    run('07:00', 3, 'a')      // 前回投稿から4時間 → 投稿
    run('10:00', 3, 'b')      // 警報の組み合わせが変わっただけ → 黙る（以前はここで投稿）
    run('12:00', 0)           // 一時的に下がる
    run('12:10', 3, 'a')      // 10分で戻る → 揺れとして黙る（以前は解除＋再投稿）
    run('13:00', 3, 'c')      // 黙る（以前は投稿）
    run('13:40', 3, 'd')      // 黙る（以前は投稿）

    expect(log).toEqual(['03:00 post', '05:30 cancel', '07:00 post'])
  })

  it('レベルが上がったときは、間隔を待たずにすぐ出す（3→4）', () => {
    let s = tick(EMPTY, '10:00', 3).state
    const r = tick(s, '10:05', 4)
    expect(r.action).toBe('post')
    s = r.state
    expect(s.level).toBe(4)
  })

  it('同じレベルが続いている間は、何度巡回しても出さない', () => {
    let s = tick(EMPTY, '10:00', 3, 'x').state
    for (const [at, hash] of [['10:10', 'y'], ['11:00', 'z'], ['15:00', 'w']] as const) {
      const r = tick(s, at, 3, hash)
      expect(r.action).toBe('none')
      s = r.state
    }
  })

  it(`下がって ${DROP_CONFIRM_MINUTES} 分未満で戻れば、解除も再投稿もしない`, () => {
    let s = tick(EMPTY, '10:00', 3).state
    const down = tick(s, '11:00', 0)
    expect(down.action).toBe('none')
    expect(down.state.droppedAt).toBeTruthy()
    expect(down.state.level).toBe(3)            // まだ下げない
    const back = tick(down.state, '11:20', 3)
    expect(back.action).toBe('none')
    expect(back.state.droppedAt).toBeUndefined() // 下がり待ちは取り消し
    s = back.state
    expect(s.level).toBe(3)
  })

  it('解除を確定した直後に同じレベルへ戻ったら、間隔が明けるまで黙る', () => {
    let s = tick(EMPTY, '10:00', 3).state
    s = tick(s, '11:00', 0).state
    const cancel = tick(s, '11:30', 0)
    expect(cancel.action).toBe('cancel')
    s = cancel.state
    const back = tick(s, '12:00', 3)             // 前回投稿 10:00 から2時間 < 3時間
    expect(back.action).toBe('skip')
    expect(back.state.level).toBe(3)             // レベルは上げておく＝以後は no change
    const later = tick(back.state, '14:00', 3)
    expect(later.action).toBe('none')
  })

  it('自動投稿レベル未満からの低下では解除を知らせない', () => {
    const cfg = { autoLevel: 4, approvalLevel: 3, minIntervalMinutes: 180 }
    let s: AutoPostState = { ...EMPTY, level: 3 }
    s = decideAutoPost(s, 0, 'h0', cfg, t('10:00')).state
    const d = decideAutoPost(s, 0, 'h0', cfg, t('10:40'))
    expect(d.action).toBe('none')
    expect(d.state.level).toBe(0)
  })
})
