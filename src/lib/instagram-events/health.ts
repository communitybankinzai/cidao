// Instagram 巡回（instagram-accounts-sync / instagram-events-sync）が止まっていないかの読み取り専用チェック。
// 見るもの: ①検索用トークンの debug_token ②監視アカウントへの business_discovery（1件だけ）
//          ③ハッシュタグ検索 ④直近の本実行の記録（event_sync_runs）⑤一時停止の状態。
// AI の読み取り・費用の記録・DB への書き込みはしない。トークンの値は返さない（末尾4桁だけ）。

import { fetchAccountMedia, INSTAGRAM_ACCOUNT_SOURCE, type MonitorAccount } from './accounts'
import { INSTAGRAM_EVENT_HASHTAG, INSTAGRAM_HASHTAG_SOURCE, lookupHashtagId } from './hashtag'

const GRAPH_BASE = 'https://graph.facebook.com/v22.0'

/** 巡回が使う権限（足りないと business_discovery が (#10) で失敗する） */
export const REQUIRED_SCOPES = ['instagram_basic', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement'] as const

/** 本実行の記録がこの時間より古いと「止まっている」とみなす（毎朝 1 回の巡回＋余裕） */
export const STALE_RUN_HOURS = 36
/** データアクセス期限までこの日数を切ったら注意 */
export const DATA_ACCESS_WARN_DAYS = 14

export type HealthStatus = 'ok' | 'warn' | 'fail'
export type HealthCheck = { name: string; status: HealthStatus; detail: string }
export type HealthReport = { status: HealthStatus; checkedAt: string; checks: HealthCheck[] }

export type RecentRun = { source: string; started_at: string; ok: boolean; errors: unknown }

export type HealthInput = {
  fetchFn: typeof fetch
  now: Date
  auth: { user_id: string; access_token: string } | null
  accounts: MonitorAccount[]
  /** 本実行（dry_run=false）の新しい順の記録 */
  recentRuns: RecentRun[]
  paused: boolean
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function worst(statuses: HealthStatus[]): HealthStatus {
  return statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : 'ok'
}

function jst(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) + ' JST'
}

export async function checkToken(fetchFn: typeof fetch, token: string, now: Date): Promise<HealthCheck> {
  const tail = token.slice(-4)
  let payload: Record<string, unknown>
  try {
    const params = new URLSearchParams({ input_token: token, access_token: token })
    const res = await fetchFn(`${GRAPH_BASE}/debug_token?${params}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    payload = asObject(await res.json().catch(() => ({})))
  } catch (e) {
    return { name: 'token', status: 'fail', detail: `debug_token に接続できない: ${e instanceof Error ? e.message : String(e)}` }
  }
  const err = asObject(payload.error)
  if (Object.keys(err).length > 0) {
    return { name: 'token', status: 'fail', detail: `(#${String(err.code ?? '?')}) ${String(err.message ?? '').slice(0, 160)}（末尾 ${tail}）` }
  }
  const d = asObject(payload.data)
  if (d.is_valid !== true) {
    const reason = String(asObject(d.error).message ?? '理由不明').slice(0, 160)
    return { name: 'token', status: 'fail', detail: `トークンが無効（末尾 ${tail}）: ${reason}` }
  }
  const scopes = Array.isArray(d.scopes) ? d.scopes.map(String) : []
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s))
  if (missing.length > 0) return { name: 'token', status: 'fail', detail: `権限が足りない: ${missing.join(', ')}（末尾 ${tail}）` }
  const notes: string[] = []
  let status: HealthStatus = 'ok'
  const exp = Number(d.expires_at)
  if (Number.isFinite(exp) && exp > 0) {
    const days = Math.floor((exp * 1000 - now.getTime()) / 86400_000)
    notes.push(`有効期限まで ${days} 日`)
    if (days < 0) status = 'fail'
    else if (days < DATA_ACCESS_WARN_DAYS) status = 'warn'
  } else {
    notes.push('有効期限なし')
  }
  const dae = Number(d.data_access_expires_at)
  if (Number.isFinite(dae) && dae > 0) {
    const days = Math.floor((dae * 1000 - now.getTime()) / 86400_000)
    notes.push(`データアクセス期限 ${jst(new Date(dae * 1000)).slice(0, 10)}（あと ${days} 日）`)
    if (days < 0) status = 'fail'
    else if (days < DATA_ACCESS_WARN_DAYS && status === 'ok') status = 'warn'
  }
  return { name: 'token', status, detail: `有効・権限 ${REQUIRED_SCOPES.length} 件そろい・${notes.join('・')}（末尾 ${tail}）` }
}

export async function checkAccount(fetchFn: typeof fetch, auth: { user_id: string; access_token: string }, account: MonitorAccount): Promise<HealthCheck> {
  const r = await fetchAccountMedia(fetchFn, { igUserId: auth.user_id, token: auth.access_token, account, limit: 1 })
  const name = `account:${account.username}`
  if (r.ok) return { name, status: 'ok', detail: `business_discovery 成功（投稿 ${r.profile.mediaCount ?? '?'} 件）` }
  const authError = /\(#(10|190|200)\)|OAuth/i.test(r.error) || r.permissionDenied
  return { name, status: authError ? 'fail' : 'warn', detail: r.error.slice(0, 200) }
}

export async function checkHashtag(fetchFn: typeof fetch, auth: { user_id: string; access_token: string }): Promise<HealthCheck> {
  try {
    const id = await lookupHashtagId(fetchFn, auth.user_id, auth.access_token, INSTAGRAM_EVENT_HASHTAG)
    return id
      ? { name: 'hashtag', status: 'ok', detail: `ig_hashtag_search「${INSTAGRAM_EVENT_HASHTAG}」成功` }
      : { name: 'hashtag', status: 'warn', detail: `ハッシュタグ「${INSTAGRAM_EVENT_HASHTAG}」が見つからない` }
  } catch (e) {
    return { name: 'hashtag', status: 'fail', detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }
}

export function checkRecentRuns(runs: RecentRun[], now: Date): HealthCheck[] {
  return [INSTAGRAM_ACCOUNT_SOURCE, INSTAGRAM_HASHTAG_SOURCE].map((source) => {
    const name = `last-run:${source}`
    const last = runs.find((r) => r.source === source)
    if (!last) return { name, status: 'warn' as const, detail: '本実行の記録がない' }
    const hours = (now.getTime() - Date.parse(last.started_at)) / 3600_000
    const when = jst(new Date(last.started_at))
    if (!last.ok) {
      const errs = Array.isArray(last.errors) ? last.errors.map(String).join(' / ').slice(0, 160) : ''
      return { name, status: 'fail' as const, detail: `直近（${when}）が失敗: ${errs || '理由不明'}` }
    }
    if (hours > STALE_RUN_HOURS) return { name, status: 'fail' as const, detail: `直近の本実行（${when}）から ${Math.floor(hours)} 時間たっている` }
    return { name, status: 'ok' as const, detail: `直近（${when}）成功・${Math.floor(hours)} 時間前` }
  })
}

export async function checkInstagramHealth(input: HealthInput): Promise<HealthReport> {
  const checks: HealthCheck[] = []
  if (input.paused) checks.push({ name: 'pause', status: 'warn', detail: '巡回は一時停止中（再開するまで動かない）' })
  if (!input.auth) {
    checks.push({ name: 'token', status: 'fail', detail: 'DB に検索用トークン（sns_instagram_discovery_auth）が無い' })
  } else {
    const auth = input.auth
    checks.push(await checkToken(input.fetchFn, auth.access_token, input.now))
    // 巡回と同じ呼び出しを、監視アカウントのうち先頭 2 件とハッシュタグ 1 件だけ試す
    const [accountChecks, hashtagCheck] = await Promise.all([
      Promise.all(input.accounts.slice(0, 2).map((a) => checkAccount(input.fetchFn, auth, a))),
      checkHashtag(input.fetchFn, auth),
    ])
    checks.push(...accountChecks, hashtagCheck)
    if (input.accounts.length === 0) checks.push({ name: 'accounts', status: 'warn', detail: '有効な監視アカウントが 0 件' })
  }
  checks.push(...checkRecentRuns(input.recentRuns, input.now))
  return { status: worst(checks.map((c) => c.status)), checkedAt: input.now.toISOString(), checks }
}
