import { describe, expect, it } from 'vitest'
import {
  eventNotifyMode,
  eventNotifyPrefs,
  isEventNotifyMode,
  wantsEventDigest,
  wantsInstantEvent,
} from '@/lib/event-notify-mode'

describe('eventNotifyMode', () => {
  it('未設定・空・null は「その都度」（これまでの動きのまま）', () => {
    expect(eventNotifyMode(undefined)).toBe('instant')
    expect(eventNotifyMode(null)).toBe('instant')
    expect(eventNotifyMode({})).toBe('instant')
    expect(eventNotifyMode({ notify_event: true })).toBe('instant')
  })

  it('notify_event=false は mode が何でも「受け取らない」（従来からOFFにしていた人を勝手に戻さない）', () => {
    expect(eventNotifyMode({ notify_event: false })).toBe('off')
    expect(eventNotifyMode({ notify_event: false, event_notify_mode: 'digest' })).toBe('off')
    expect(eventNotifyMode({ notify_event: false, event_notify_mode: 'instant' })).toBe('off')
  })

  it('digest は「毎日まとめて」。知らない値は「その都度」に倒す', () => {
    expect(eventNotifyMode({ notify_event: true, event_notify_mode: 'digest' })).toBe('digest')
    expect(eventNotifyMode({ event_notify_mode: 'digest' })).toBe('digest')
    expect(eventNotifyMode({ event_notify_mode: 'weekly' })).toBe('instant')
  })
})

describe('eventNotifyPrefs', () => {
  it('mode と notify_event が食い違わない（他の仕組みは notify_event を見ている）', () => {
    expect(eventNotifyPrefs('instant')).toEqual({ notify_event: true, event_notify_mode: 'instant' })
    expect(eventNotifyPrefs('digest')).toEqual({ notify_event: true, event_notify_mode: 'digest' })
    expect(eventNotifyPrefs('off')).toEqual({ notify_event: false, event_notify_mode: 'off' })
  })

  it('保存した値を読み戻すと同じ mode になる', () => {
    for (const m of ['instant', 'digest', 'off'] as const) {
      expect(eventNotifyMode(eventNotifyPrefs(m))).toBe(m)
    }
  })
})

describe('宛先の条件', () => {
  it('すぐ知らせるのは「その都度」だけ。まとめの人はまとめだけ。受け取らない人はどちらも対象外', () => {
    const instant = { notify_event: true, event_notify_mode: 'instant' }
    const digest = { notify_event: true, event_notify_mode: 'digest' }
    const off = { notify_event: false, event_notify_mode: 'off' }
    expect([wantsInstantEvent(instant), wantsInstantEvent(digest), wantsInstantEvent(off)]).toEqual([true, false, false])
    expect([wantsEventDigest(instant), wantsEventDigest(digest), wantsEventDigest(off)]).toEqual([false, true, false])
  })

  it('isEventNotifyMode は3つの値だけを通す', () => {
    expect(isEventNotifyMode('instant')).toBe(true)
    expect(isEventNotifyMode('digest')).toBe(true)
    expect(isEventNotifyMode('off')).toBe(true)
    expect(isEventNotifyMode('on')).toBe(false)
    expect(isEventNotifyMode(null)).toBe(false)
  })
})
