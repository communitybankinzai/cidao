// 管理画面 /admin/sns の「承認のルール」カードの確認（説明と実際の動きがずれていないか）
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ApprovalRules from '@/app/admin/sns/_components/ApprovalRules'
import { REPOST_MIN_INTERVAL_HOURS } from '@/lib/sns-edit-compare'

const html = (freefreeAuto: boolean, proposalAuto: boolean) =>
  renderToStaticMarkup(createElement(ApprovalRules, { freefreeAuto, proposalAuto }))

describe('承認のルールの表示', () => {
  it('全自動モードがオンなら、新規掲載は「自動で出る」と書く', () => {
    const h = html(true, false)
    expect(h).toContain('全自動モード：オン')
    expect(h).toContain('承認なしで、すぐ Threads・Facebook・Instagram に出ます')
  })
  it('全自動モードがオフなら、新規掲載は承認待ちと書き、編集後は出さないと書く', () => {
    const h = html(false, false)
    expect(h).toContain('全自動モード：オフ')
    expect(h).toContain('承認待ちの下書きになります（全自動モードがオフのため）')
    expect(h).toContain('次の定期紹介が、配信時の最新の中身で出します')
  })
  it('24時間は、動きを決めている定数と同じ数字を出す', () => {
    expect(html(true, true)).toContain(`${REPOST_MIN_INTERVAL_HOURS}時間以内`)
  })
  it('運営が作った掲載は常に承認待ち・古い投稿は自動では消えないと書く', () => {
    const h = html(true, true)
    expect(h).toContain('常に承認待ち')
    expect(h).toContain('自動では消えません')
  })
  it('最初は閉じている（見出しを押すと開く）', () => {
    const h = html(true, true)
    expect(h).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/)
    expect(h).toContain('📋 承認のルール')
  })
  it('提案の全自動モードの状態も表に出る', () => {
    expect(html(true, true)).toContain('提案の全自動モード：オン')
    expect(html(true, false)).toContain('提案の全自動モード：オフ')
  })
})
