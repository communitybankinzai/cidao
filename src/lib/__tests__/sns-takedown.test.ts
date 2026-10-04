import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeTakedown, groupByPost, mediumLabel, postUrlOf, type TakedownRow } from '../sns-takedown'

const row = (over: Partial<TakedownRow>): TakedownRow => ({
  id: 'r1', post_title: '木まぐれKopitiam', medium: 'threads', posted_id: '17900001', withdrawn_at: '2026-10-03T12:00:00Z', ...over,
})

test('削除待ちの案内: 媒体ごとに投稿の手がかり（FacebookはURL・他はID）を出す', () => {
  expect(postUrlOf('facebook', '123_456')).toBe('https://www.facebook.com/123_456')
  expect(postUrlOf('threads', '17900001')).toBeNull()
  expect(postUrlOf('facebook', null)).toBeNull()
  expect(describeTakedown(row({}))).toBe('Threads：投稿ID 17900001')
  expect(describeTakedown(row({ medium: 'facebook', posted_id: '123_456' }))).toBe('Facebook：https://www.facebook.com/123_456')
  expect(describeTakedown(row({ medium: 'instagram', posted_id: null }))).toContain('投稿IDなし')
  expect(mediumLabel('instagram')).toBe('Instagram')
})

test('削除待ちの通知: 同じ掲載の媒体をまとめる', () => {
  const g = groupByPost([row({ id: 'a' }), row({ id: 'b', medium: 'facebook' }), row({ id: 'c', post_title: '別の店' })])
  expect(g.size).toBe(2)
  expect(g.get('木まぐれKopitiam')?.map((r) => r.id)).toEqual(['a', 'b'])
})

// 取り下げ（非公開・完全削除）の検知は DB トリガーが担う。本番 DB に触れないテストでは、
// 定義が「配信済みを控える／下書きを消す／二重に拾わない」を満たしていることを SQL の文面で固定する
const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20261003230000_freefree_sns_takedowns.sql'), 'utf8')

test('マイグレーション: 非公開と完全削除の両方で動き、配信済みだけを控え、未配信の下書きを消す', () => {
  expect(sql).toMatch(/after update of status or delete on public\.freefree_posts/)
  expect(sql).toMatch(/l\.status = 'success'/)
  expect(sql).toMatch(/delete from sns_post_logs[\s\S]*status = 'pending'/)
  expect(sql).toMatch(/on conflict \(log_id\) do nothing/)
  expect(sql).toMatch(/old\.status is not distinct from 'removed'/)
})

test('マイグレーション: 管理者以外は読めず、更新できるのは削除済みの記録の2列だけ', () => {
  expect(sql).toMatch(/enable row level security/)
  expect(sql).toMatch(/for select using \(public\.is_admin\(\)\)/)
  expect(sql).toMatch(/grant select, update \(removed_at, removed_by\) on public\.sns_takedowns to authenticated/)
  expect(sql).not.toMatch(/grant (insert|delete)/)
})
