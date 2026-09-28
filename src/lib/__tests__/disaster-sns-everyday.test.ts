// 平時の道路・交通の困りごと（2026-09-28）：巡回のふるい・AI に渡す前のふるい・公開用の形
import { describe, expect, it } from 'vitest'
import { matchesScope, type MonitorItem } from '../disaster-sns-monitor'
import { looksLikeRoadPost, toPublicReport } from '../disaster-sns-road-ai'

const item = (text: string, query = '印西'): MonitorItem => ({
  platform: 'threads', externalId: '1', permalink: 'https://www.threads.net/@a/post/1', username: 'a', text, commentsText: '',
  mediaUrl: '', timestamp: '2026-09-28T01:00:00Z', locationName: '', lat: null, lng: null, query, raw: {},
})

describe('巡回のふるい（平時）', () => {
  it('場所語と道路の困りごとがあれば候補にする', () => {
    expect(matchesScope(item('印西牧の原の県道で工事、片側交互通行になってる'))).toBe(true)
    expect(matchesScope(item('国道464号 北須賀あたり事故で渋滞してます', '通行止め'))).toBe(true)
    expect(matchesScope(item('木下の道路に穴が開いてて危ない'))).toBe(true)
  })
  it('道路と関係ない工事・場所語の無い話は候補にしない', () => {
    expect(matchesScope(item('印西市のカフェ、改装工事中でした', 'カフェ'))).toBe(false)
    expect(matchesScope(item('首都高で事故渋滞', '渋滞'))).toBe(false)
  })
  it('災害の投稿はこれまでどおり候補にする', () => {
    expect(matchesScope(item('印西市 師戸で冠水'))).toBe(true)
  })
})

describe('AI に渡す前のふるい（平時）', () => {
  it('工事・事故・道路の傷みの投稿は AI に渡す', () => {
    expect(looksLikeRoadPost('464号で事故、渋滞がひどい')).toBe(true)
    expect(looksLikeRoadPost('牧の原で片側交互通行の工事')).toBe(true)
    expect(looksLikeRoadPost('交差点の手前に陥没があります')).toBe(true)
  })
  it('通行に触れない投稿は渡さない', () => {
    expect(looksLikeRoadPost('新しいパン屋さんができた')).toBe(false)
  })
})

describe('公開用の形', () => {
  const row = { id: 'x', kind: 'caution', cause: 'construction', latitude: 35.8, longitude: 140.2, posted_at: '2026-09-28T01:00:00Z', confidence: 'high' }
  it('注意と理由をそのまま返す', () => {
    expect(toPublicReport(row)).toMatchObject({ kind: 'caution', cause: 'construction' })
  })
  it('知らない理由・理由の無い古い行は空文字にする', () => {
    expect(toPublicReport({ ...row, cause: 'weird' }).cause).toBe('')
    expect(toPublicReport({ ...row, cause: undefined }).cause).toBe('')
  })
})
