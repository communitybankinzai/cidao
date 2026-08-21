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

export type DailyRequests = { day: string; requests: number }

const DAILY_CACHE_TTL_MS = 300_000
let dailyCache: { days: number; value: DailyRequests[]; expiresAt: number } | null = null

// 直近 days 日分の「1日ごとのタイルリクエスト数」。day ラベルは **日本時間の日付**。
// 日別ユニーク利用者数（metaverse_presence_daily）が JST 日で記録されているため、
// 「1人あたりのタイル消費」を出せるよう同じ区切りに揃えている（2026-08-21 変更。
// それ以前は Google の課金日＝太平洋時間0時基準で、利用者数と最大16時間ずれていた）。
// クォータ枠の消化率だけは課金日で見る必要があるため getTodayMapTilesUsage は太平洋基準のまま。
//
// Monitoring の集計区間は endTime から遡って区切られる性質を使い、
// endTime を直近の JST 0時に置いて完了日を取り、進行中の当日は別クエリで足す。
// Monitoring への問い合わせは 5 分キャッシュ。取得できなければ null
export async function getDailyMapTilesUsage(days: number): Promise<DailyRequests[] | null> {
  const now = Date.now()
  if (dailyCache && dailyCache.days === days && dailyCache.expiresAt > now) return dailyCache.value

  const projectId = process.env.GCP_PROJECT_ID?.trim()
  const rawKey = process.env.GCP_SA_KEY?.trim()
  if (!projectId || !rawKey) return null
  const sa = parseServiceAccountKey(rawKey)
  if (!sa) return null

  try {
    const token = await fetchAccessToken(sa)
    const todayStartMs = jstDayStartMs(now)
    const byDay = new Map<string, number>()

    // 完了した日（前日まで）。区間 [end-24h, end] の中身は終了直前の JST 日付にあたる
    if (days > 1) {
      const points = await queryTimeSeries(projectId, token, {
        startTime: new Date(todayStartMs - (days - 1) * 86_400_000).toISOString(),
        endTime: new Date(todayStartMs).toISOString(),
        alignmentSec: 86_400,
      })
      for (const pt of points) {
        if (!pt.endTime) continue
        const key = jstDate(new Date(pt.endTime).getTime() - 1000)
        byDay.set(key, (byDay.get(key) ?? 0) + pt.value)
      }
    }

    // 進行中の当日（JST 0時から今まで）
    const elapsedSec = Math.max(60, Math.floor((now - todayStartMs) / 1000))
    const todayPoints = await queryTimeSeries(projectId, token, {
      startTime: new Date(todayStartMs).toISOString(),
      endTime: new Date(now).toISOString(),
      alignmentSec: elapsedSec,
    })
    const todaySum = todayPoints.reduce((acc, pt) => acc + pt.value, 0)
    byDay.set(jstDate(now), todaySum)

    const value = [...byDay.entries()]
      .map(([day, requests]) => ({ day, requests: Math.round(requests) }))
      .sort((x, y) => (x.day < y.day ? -1 : 1))
    dailyCache = { days, value, expiresAt: now + DAILY_CACHE_TTL_MS }
    return value
  } catch {
    return null
  }
}

type Point = { endTime?: string; value: number }

// Monitoring の timeSeries を1回叩いて、全系列の点を素直な配列で返す
async function queryTimeSeries(
  projectId: string,
  token: string,
  opt: { startTime: string; endTime: string; alignmentSec: number },
): Promise<Point[]> {
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries`)
  url.searchParams.set('filter', FILTER)
  url.searchParams.set('interval.startTime', opt.startTime)
  url.searchParams.set('interval.endTime', opt.endTime)
  url.searchParams.set('aggregation.alignmentPeriod', `${opt.alignmentSec}s`)
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM')
  url.searchParams.set('aggregation.crossSeriesReducer', 'REDUCE_SUM')
  url.searchParams.set('view', 'FULL')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`monitoring ${res.status}`)
  const body = (await res.json()) as {
    timeSeries?: Array<{ points?: Array<{ interval?: { endTime?: string }; value?: { int64Value?: string; doubleValue?: number } }> }>
  }
  const out: Point[] = []
  for (const series of body.timeSeries ?? []) {
    for (const pt of series.points ?? []) {
      out.push({ endTime: pt.interval?.endTime, value: Number(pt.value?.int64Value ?? pt.value?.doubleValue ?? 0) })
    }
  }
  return out
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
// 日本時間の日付 YYYY-MM-DD
export function jstDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(ms))
}

// 直近の日本時間0時（ミリ秒）
function jstDayStartMs(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const elapsedMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000
  return ms - elapsedMs - (ms % 1000)
}

// 太平洋時間の日付 YYYY-MM-DD（Google Maps Platform の課金日）
export function pacificDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms))
}

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

