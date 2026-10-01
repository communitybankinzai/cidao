// Instagram #印西 取り込みの「一時停止」。
// 状態は app_settings（key=instagram_events_sync）に持ち、cron は実行前にこれを見て止まる。
// メールの一時停止ボタンはログイン無しで押せるよう、CRON_SECRET から導いた署名トークンで守る。

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const PAUSE_SETTING_KEY = 'instagram_events_sync'

export type PauseState = { paused: boolean; changed_at: string | null; via: string | null }

/** メールのボタン用トークン（CRON_SECRET が変わると古いメールのボタンは効かなくなる） */
export function pauseToken(cronSecret: string): string {
  return createHmac('sha256', cronSecret).update('instagram-events-sync:pause').digest('hex')
}

export function verifyPauseToken(cronSecret: string, token: string | null | undefined): boolean {
  if (!cronSecret || !token) return false
  const expected = Buffer.from(pauseToken(cronSecret), 'utf8')
  const given = Buffer.from(String(token), 'utf8')
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function pausePageUrl(baseUrl: string, cronSecret: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/instagram-events/pause?token=${pauseToken(cronSecret)}`
}

export async function readPauseState(supabase: SupabaseClient): Promise<PauseState> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', PAUSE_SETTING_KEY).maybeSingle()
  if (error) throw new Error(`readPauseState: ${error.message}`)
  const v = (data?.value ?? null) as { paused?: unknown; changed_at?: unknown; via?: unknown } | null
  return {
    paused: v?.paused === true,
    changed_at: typeof v?.changed_at === 'string' ? v.changed_at : null,
    via: typeof v?.via === 'string' ? v.via : null,
  }
}

export async function writePauseState(supabase: SupabaseClient, paused: boolean, via: string): Promise<PauseState> {
  const state: PauseState = { paused, changed_at: new Date().toISOString(), via }
  const { error } = await supabase.from('app_settings').upsert({ key: PAUSE_SETTING_KEY, value: state, updated_at: state.changed_at })
  if (error) throw new Error(`writePauseState: ${error.message}`)
  return state
}

const fmtJst = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function describePauseState(s: PauseState): string {
  if (!s.paused) return '稼働中（毎朝 06:35 に自動で取り込み）'
  const when = s.changed_at ? fmtJst.format(new Date(s.changed_at)) : '不明'
  const via = s.via === 'email' ? 'メールのボタン' : s.via === 'admin' ? '管理画面' : s.via ?? '不明'
  return `一時停止中（${when} に${via}から停止）。再開するまで朝の取り込みを行いません`
}
