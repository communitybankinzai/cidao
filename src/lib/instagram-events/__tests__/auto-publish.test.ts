import { describe, expect, it } from 'vitest'
import { AUTO_PUBLISH_MAX_DAYS_AHEAD, autoPublishMark, decideAutoPublish, type AutoPublishInput } from '../auto-publish'

const ok: AutoPublishInput = {
  fromAccount: true,
  accountAutoPublish: true,
  title: 'クリスマスここのわカフェ',
  location: '船穂コミュニティーセンター',
  onlineFlag: false,
  timeAssumed: false,
  date: '2026-12-14',
  today: '2026-11-18',
}

describe('decideAutoPublish（巡回先の催しを自動で公開するか）', () => {
  it('巡回先の投稿で、欠けがなければ公開する', () => {
    expect(decideAutoPublish(ok)).toEqual({ publish: true })
  })

  it('巡回先の設定が未設定（null・undefined）なら公開する', () => {
    expect(decideAutoPublish({ ...ok, accountAutoPublish: null }).publish).toBe(true)
    expect(decideAutoPublish({ ...ok, accountAutoPublish: undefined }).publish).toBe(true)
  })

  it('「下書きのまま」と決めた巡回先は公開しない', () => {
    expect(decideAutoPublish({ ...ok, accountAutoPublish: false })).toEqual({ publish: false, reason: '巡回先の設定が下書きのまま' })
  })

  it('ハッシュタグ検索の投稿は公開しない', () => {
    expect(decideAutoPublish({ ...ok, fromAccount: false })).toEqual({ publish: false, reason: 'ハッシュタグ検索の投稿' })
  })

  it('時刻が仮置きなら公開しない', () => {
    expect(decideAutoPublish({ ...ok, timeAssumed: true })).toEqual({ publish: false, reason: '時刻が仮置き' })
  })

  it('会場が読めなければ公開しない（オンラインなら会場なしでも公開する）', () => {
    expect(decideAutoPublish({ ...ok, location: '  ' })).toEqual({ publish: false, reason: '会場が読めない' })
    expect(decideAutoPublish({ ...ok, location: '', onlineFlag: true }).publish).toBe(true)
  })

  it('題名が読めなければ公開しない', () => {
    expect(decideAutoPublish({ ...ok, title: '（題名なし）' }).publish).toBe(false)
    expect(decideAutoPublish({ ...ok, title: ' ' }).publish).toBe(false)
  })

  it('開催日が半年より先なら公開しない（年の読み違いの疑い）', () => {
    // 2026-11-18 に取り込まれた「2027-11-09」の催し（実例）
    const far = decideAutoPublish({ ...ok, date: '2027-11-09' })
    expect(far).toEqual({ publish: false, reason: `開催日が${AUTO_PUBLISH_MAX_DAYS_AHEAD}日より先` })
  })

  it('ちょうど上限の日は公開し、1日でも先は公開しない', () => {
    // 2026-11-18 の 183 日後は 2027-05-20
    expect(decideAutoPublish({ ...ok, date: '2027-05-20' }).publish).toBe(true)
    expect(decideAutoPublish({ ...ok, date: '2027-05-21' }).publish).toBe(false)
  })

  it('きょうの催しは公開し、過去・不正な日付は公開しない', () => {
    expect(decideAutoPublish({ ...ok, date: '2026-11-18' }).publish).toBe(true)
    expect(decideAutoPublish({ ...ok, date: '2026-11-17' })).toEqual({ publish: false, reason: '開催日が不正' })
    expect(decideAutoPublish({ ...ok, date: 'x' })).toEqual({ publish: false, reason: '開催日が不正' })
  })
})

describe('autoPublishMark（報告に付ける印）', () => {
  it('公開と下書きで印が変わる', () => {
    expect(autoPublishMark({ publish: true })).toBe('〔公開〕')
    expect(autoPublishMark({ publish: false, reason: '時刻が仮置き' })).toBe('〔下書き：時刻が仮置き〕')
  })
})
