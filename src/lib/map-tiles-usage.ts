// Google Map Tiles API の「本日のリクエスト数」を Cloud Monitoring から取得する軽量ヘルパー。
// 管理画面の詳細版（/api/admin/analytics/map-tiles）とは別に、メタバース画面へ公開表示するための
// 最小実装。Monitoring API への問い合わせは 120 秒キャッシュして、閲覧者が増えても叩きすぎない。
//
// 認証: サービスアカウント（GCP_SA_KEY / GCP_PROJECT_ID、Monitoring Viewer のみ）
// 指標: maps.googleapis.com/service/v2/request_count（resource.labels.service = tile.googleapis.com）

import { createSign } from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const MONITORING_SCOPE = 'https://www.googleapis.com/auth/monitoring.read'
const FILTER =
  'metric.type = "maps.googleapis.com/service/v2/request_count" ' +
  'AND resource.type = "maps.googleapis.com/Api" ' +
  'AND resource.labels.service = "tile.googleapis.com"'
const CACHE_TTL_MS = 120_000

type ServiceAccountKey = { clientEmail: string; privateKey: string; tokenUri: string }

export type TodayUsage = {
  date: string          // JST の日付 YYYY-MM-DD
  todayRequests: number // 本日のタイルリクエスト数（root＋renderer 合計）
  fetchedAt: string
}

let cache: { value: TodayUsage; expiresAt: number } | null = null

export function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

// 取得できない場合は null（未設定・認証失敗・Monitoring 障害）。呼び出し側は表示を省略する
export async function getTodayMapTilesUsage(): Promise<TodayUsage | null> {
  const now = Date.now()
  if (cache && cache.expiresAt > now && cache.value.date === jstToday()) return cache.value

  const projectId = process.env.GCP_PROJECT_ID?.trim()
  const rawKey = process.env.GCP_SA_KEY?.trim()
  if (!projectId || !rawKey) return null
  const sa = parseServiceAccountKey(rawKey)
  if (!sa) return null

  try {
    const token = await fetchAccessToken(sa)
    const today = jstToday()
    // Google の1日クォータは太平洋時間の0時（日本時間16時ごろ）にリセットされるため、
    // 「本日」はクォータ集計日に合わせて直近の太平洋0時からの累計にする
    const startTime = pacificDayStartIso()
    const endTime = new Date().toISOString()
    const windowSec = Math.max(60, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
    const url = new URL(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries`)
    url.searchParams.set('filter', FILTER)
    url.searchParams.set('interval.startTime', startTime)
    url.searchParams.set('interval.endTime', endTime)
    url.searchParams.set('aggregation.alignmentPeriod', `${windowSec}s`)
    url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM')
    url.searchParams.set('aggregation.crossSeriesReducer', 'REDUCE_SUM')
    url.searchParams.set('view', 'FULL')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as {
      timeSeries?: Array<{ points?: Array<{ value?: { int64Value?: string; doubleValue?: number } }> }>
    }
    let total = 0
    for (const series of body.timeSeries ?? []) {
      for (const p of series.points ?? []) {
        total += Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0)
      }
    }
    const value: TodayUsage = { date: today, todayRequests: Math.round(total), fetchedAt: new Date().toISOString() }
    cache = { value, expiresAt: now + CACHE_TTL_MS }
    return value
  } catch {
    return null
  }
}

function parseServiceAccountKey(raw: string): ServiceAccountKey | null {
  const obj = parseJson(raw) ?? parseJson(Buffer.from(raw, 'base64').toString('utf8'))
  if (!obj) return null
  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email : ''
  const privateKey = typeof obj.private_key === 'string' ? obj.private_key.replace(/\\n/g, '\n') : ''
  const tokenUri = typeof obj.token_uri === 'string' ? obj.token_uri : TOKEN_URL
  if (!clientEmail || !privateKey) return null
  return { clientEmail, privateKey, tokenUri }
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function fetchAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (b: Buffer) => b.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  const header = b64(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = b64(Buffer.from(JSON.stringify({
    iss: sa.clientEmail, scope: MONITORING_SCOPE, aud: sa.tokenUri, iat: now, exp: now + 3600,
  })))
  const unsigned = `${header}.${payload}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.privateKey)
  const assertion = `${unsigned}.${b64(signature)}`
  const res = await fetch(sa.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('token-request-failed')
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error('token-response-invalid')
  return body.access_token
}

// 直近の太平洋時間0時（Google Maps Platform の日次クォータのリセット時刻）を ISO で返す。夏時間も Intl が吸収する
function pacificDayStartIso(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const elapsedMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000
  return new Date(now.getTime() - elapsedMs - now.getMilliseconds()).toISOString()
}

