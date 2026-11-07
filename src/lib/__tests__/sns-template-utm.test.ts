import { describe, it, expect } from 'vitest'
import { generateSnsContent, generateImportSnsContent, withUtm } from '../sns-template'
import { isValidSignupSource, buildSignupSource, signupSourceLabel } from '../signup-source'

// SNS に載せる CiDAO のリンクは媒体別の utm 付き（2026-11-07・事業主指示「改善提案実施」）。
// 閲覧（page_views.source）と新規登録（members.signup_source）を媒体ごとに数えるため。

const freefree = {
  target_type: 'freefree' as const,
  target_id: 'abc-123',
  title: '手づくり市',
  body: '本文',
  category: 'event',
  location: '印西市',
  poster_name: '印西手芸の会',
  event_start_date: null,
  end_date: null,
}

describe('SNS 告知リンクの utm', () => {
  it('withUtm は媒体名と告知の種類を付ける（媒体なしは sns・utm_medium は付けない）', () => {
    expect(withUtm('/events/e1', 'threads', 'event_announce')).toBe('https://cidao.vercel.app/events/e1?utm_source=threads&utm_campaign=event_announce')
    expect(withUtm('/freefree', undefined, 'freefree_board')).toContain('utm_source=sns')
  })
  it('FreeFree の Threads・Facebook・X・LINE は掲載ページと掲示板トップの両方に媒体別の utm', () => {
    for (const medium of ['threads', 'facebook', 'line'] as const) {
      const t = generateSnsContent(freefree, medium)
      expect(t).toContain(`/freefree/abc-123?utm_source=${medium}&utm_campaign=freefree_announce`)
      expect(t).toContain(`/freefree?utm_source=${medium}&utm_campaign=freefree_board`)
    }
    const x = generateSnsContent(freefree, 'x')
    expect(x).toContain('/freefree/abc-123?utm_source=x&utm_campaign=freefree_announce')
  })
  it('Instagram は URL を載せない（プロフィールのリンクへ誘導）', () => {
    expect(generateSnsContent(freefree, 'instagram')).not.toContain('http')
  })
  it('団体・提案のリンクにも utm', () => {
    expect(generateSnsContent({ target_type: 'org', target_id: 'o1', title: '団体', body: '' }, 'threads'))
      .toContain('/orgs/o1?utm_source=threads&utm_campaign=org_announce')
    expect(generateSnsContent({ target_type: 'proposal', target_id: 'p1', title: '提案', body: '', deadline: null }, 'facebook'))
      .toContain('/proposals/p1?utm_source=facebook&utm_campaign=proposal_announce')
  })
  it('運営が作った掲載（公開データ由来）は掲載ページと「お店の方へ」の両方に utm', () => {
    const t = generateImportSnsContent({ ...freefree, import_source: 'openpoi', poster_name: null }, 'threads')
    expect(t).toContain('/freefree/abc-123?utm_source=threads&utm_campaign=freefree_announce')
    expect(t).toContain('/freefree/for-shops?utm_source=threads&utm_campaign=freefree_forshops')
  })
  it('utm の値はそのまま signup_source になれる（各20文字まで）', () => {
    for (const c of ['freefree_announce', 'freefree_board', 'freefree_forshops', 'event_announce', 'org_announce', 'proposal_announce', 'daily_events']) {
      const v = buildSignupSource('threads', null, c)
      expect(v).toBe(`threads:${c}`)
      expect(isValidSignupSource(v)).toBe(true)
    }
  })
  it('管理画面の表示名：媒体と告知の種類に分けて読める', () => {
    expect(signupSourceLabel('threads:freefree_announce')).toBe('Threads の FreeFree の告知')
    expect(signupSourceLabel('facebook:event_announce')).toBe('Facebook の イベントの告知')
    expect(signupSourceLabel('threads:social:daily_events')).toBe('Threads の 毎朝のイベントまとめ')
    expect(signupSourceLabel('metaverse:reception:entry')).toBe('３次元MAP 受付画面の登録QR')
    expect(signupSourceLabel('unknown:thing')).toBe('unknown:thing')
    expect(signupSourceLabel(null)).toBe('（記録なし）')
  })
})
