// GET /api/admin/analytics/map-tiles
// Google Map Tiles API の Cloud Monitoring 日別リクエスト数を管理者向けに返す。
//
// 指標とリソースは Google 公式ドキュメントで確認済み:
// - https://cloud.google.com/monitoring/api/metrics_gcp_p_z#maps.googleapis.com
// - https://cloud.google.com/monitoring/api/resources#tag_maps.googleapis.com/Api
// - https://developers.google.com/maps/documentation/tile/cloud-setup

import { createSign } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const MONITORING_SCOPE = 'https://www.googleapis.com/auth/monitoring.read'
const MAP_TILES_METRIC_TYPE = 'maps.googleapis.com/service/v2/request_count'
const MAP_TILES_RESOURCE_TYPE = 'maps.googleapis.com/Api'
const MAP_TILES_SERVICE_LABEL = 'tile.googleapis.com'
const MAP_TILES_FILTER =
  `metric.type = "${MAP_TILES_METRIC_TYPE}" ` +
  `AND resource.type = "${MAP_TILES_RESOURCE_TYPE}" ` +
  `AND resource.labels.service = "${MAP_TILES_SERVICE_LABEL}"`

type ServiceAccountKey = {
  clientEmail: string
  privateKey: string
  tokenUri: string
}

type MonitoringPoint = {
  interval?: { endTime?: string }
  value?: {
    int64Value?: string
    doubleValue?: number
  }
}

type MonitoringTimeSeries = {
  points?: MonitoringPoint[]
}

type MonitoringListResponse = {
  timeSeries?: MonitoringTimeSeries[]
  nextPageToken?: string
}

type DailyRequestCount = {
  date: string
  requestCount: number
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized', message: 'ログインが必要です' },
      { status: 401 },
    )
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')
  if (adminError || !isAdmin) {
    return NextResponse.json(
      { ok: false, reason: 'forbidden', message: '管理者権限が必要です' },
      { status: 403 },
    )
  }

  const projectId = process.env.GCP_PROJECT_ID?.trim()
  const rawKey = process.env.GCP_SA_KEY?.trim()
  if (!projectId || !rawKey) {
    return NextResponse.json({
      ok: false,
      configured: false,
      reason: 'not-configured',
      message: 'Google Cloud連携が未設定です',
    })
  }

  const serviceAccount = parseServiceAccountKey(rawKey)
  if (!serviceAccount) {
    return NextResponse.json({
      ok: false,
      configured: true,
      reason: 'invalid-config',
      message: 'Google Cloud連携の設定を確認してください',
    })
  }

  try {
    const today = formatJstDate(new Date())
    const startDay = shiftDate(today, -29)
    const startTime = jstDateStartToUtcIso(startDay)
    const endTime = new Date().toISOString()
    const accessToken = await fetchAccessToken(serviceAccount)
    const timeSeries = await fetchMapTilesTimeSeries({
      accessToken,
      projectId,
      startTime,
      endTime,
    })
    const daily = buildDailyRequestCounts(timeSeries, startDay, today)
    const last7Total = sumDaily(daily.slice(-7))
    const previous7Total = sumDaily(daily.slice(-14, -7))
    const weekOverWeekChange =
      previous7Total === 0 ? null : Math.round(((last7Total - previous7Total) / previous7Total) * 1000) / 10

    return NextResponse.json({
      ok: true,
      configured: true,
      metricType: MAP_TILES_METRIC_TYPE,
      filter: MAP_TILES_FILTER,
      generatedAt: new Date().toISOString(),
      daily,
      last7Total,
      previous7Total,
      weekOverWeekChange,
    })
  } catch {
    console.error('[admin/analytics/map-tiles] Cloud Monitoring request failed')
    return NextResponse.json({
      ok: false,
      configured: true,
      reason: 'api-error',
      message: 'Google Cloud Monitoring API から取得できませんでした',
    })
  }
}

function parseServiceAccountKey(raw: string): ServiceAccountKey | null {
  const value = parseJsonObject(raw) ?? parseJsonObject(decodeBase64(raw))
  if (!value) return null

  const clientEmail = stringValue(value.client_email)
  const privateKey = stringValue(value.private_key)?.replace(/\\n/g, '\n')
  const tokenUri = stringValue(value.token_uri) ?? TOKEN_URL
  if (!clientEmail || !privateKey) return null

  return { clientEmail, privateKey, tokenUri }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function decodeBase64(raw: string): string | null {
  try {
    return Buffer.from(raw, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function fetchAccessToken(serviceAccount: ServiceAccountKey): Promise<string> {
  const assertion = createServiceAccountJwt(serviceAccount)
  const response = await fetch(serviceAccount.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('token-request-failed')

  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.access_token !== 'string') {
    throw new Error('token-response-invalid')
  }
  return body.access_token
}

function createServiceAccountJwt(serviceAccount: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlJson({
    iss: serviceAccount.clientEmail,
    scope: MONITORING_SCOPE,
    aud: serviceAccount.tokenUri,
    iat: now,
    exp: now + 3600,
  })
  const unsigned = `${header}.${payload}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(serviceAccount.privateKey)
  return `${unsigned}.${base64Url(signature)}`
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value), 'utf8'))
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function fetchMapTilesTimeSeries(input: {
  accessToken: string
  projectId: string
  startTime: string
  endTime: string
}): Promise<MonitoringTimeSeries[]> {
  const timeSeries: MonitoringTimeSeries[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(input.projectId)}/timeSeries`)
    url.searchParams.set('filter', MAP_TILES_FILTER)
    url.searchParams.set('interval.startTime', input.startTime)
    url.searchParams.set('interval.endTime', input.endTime)
    url.searchParams.set('aggregation.alignmentPeriod', '86400s')
    url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM')
    url.searchParams.set('aggregation.crossSeriesReducer', 'REDUCE_SUM')
    url.searchParams.set('view', 'FULL')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('monitoring-request-failed')

    const body: MonitoringListResponse = await response.json()
    timeSeries.push(...(body.timeSeries ?? []))
    pageToken = body.nextPageToken || undefined
  } while (pageToken)

  return timeSeries
}

function buildDailyRequestCounts(
  timeSeries: MonitoringTimeSeries[],
  startDay: string,
  endDay: string,
): DailyRequestCount[] {
  const days = dateRange(startDay, endDay)
  const counts = new Map(days.map((day) => [day, 0]))

  for (const series of timeSeries) {
    for (const point of series.points ?? []) {
      const endTime = point.interval?.endTime
      if (!endTime) continue
      const day = pointEndTimeToJstDay(endTime)
      if (!counts.has(day)) continue
      counts.set(day, (counts.get(day) ?? 0) + pointValue(point))
    }
  }

  return days.map((date) => ({ date, requestCount: counts.get(date) ?? 0 }))
}

function pointValue(point: MonitoringPoint): number {
  const intValue = point.value?.int64Value
  if (typeof intValue === 'string') {
    const value = Number(intValue)
    return Number.isFinite(value) ? value : 0
  }
  const doubleValue = point.value?.doubleValue
  return typeof doubleValue === 'number' && Number.isFinite(doubleValue) ? doubleValue : 0
}

function pointEndTimeToJstDay(endTime: string): string {
  const end = new Date(endTime)
  const oneMsEarlier = new Date(end.getTime() - 1)
  const endDay = formatJstDate(end)
  return formatJstDate(oneMsEarlier) === endDay ? endDay : formatJstDate(oneMsEarlier)
}

function sumDaily(rows: DailyRequestCount[]): number {
  return rows.reduce((sum, row) => sum + row.requestCount, 0)
}

function dateRange(startDay: string, endDay: string): string[] {
  const days: string[] = []
  for (let day = startDay; day <= endDay; day = shiftDate(day, 1)) {
    days.push(day)
  }
  return days
}

function formatJstDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(date)
}

function jstDateStartToUtcIso(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date, -9, 0, 0, 0)).toISOString()
}

function shiftDate(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
