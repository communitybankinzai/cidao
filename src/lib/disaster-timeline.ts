// 災害タイムライン：情報源レジストリ（disaster_info_sources）ごとのパーサと取得・保存処理。
// 情報源はコードに固定せず DB に置く。新しい kind を増やすときは PARSERS に関数を 1 つ足すだけでよい。
// 呼び出し元：/api/disaster/timeline（POST, cron）、/admin/disaster-sources（テスト取得・今すぐ巡回）。

import { createHash } from 'node:crypto'
import { parse as parseHtml } from 'node-html-parser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchOfficialUpdates } from '@/lib/inzai-city-alerts'

export type SourceTrust = 'official' | 'semi-official' | 'unverified'
export type ChangeType = 'new' | 'update' | 'cancel'

export type InfoSource = {
  id: string
  kind: string
  label: string
  url: string
  config: Record<string, unknown>
  trust: SourceTrust
  enabled: boolean
}

export type TimelineItemDraft = {
  externalKey: string
  occurredAt: string // ISO 8601（タイムゾーン付き）
  title: string
  body: string
  url: string | null
  areaTag: string | null
  changeType?: ChangeType
  priority?: number
  raw?: Record<string, unknown>
}

export type ParserContext = {
  supabase: SupabaseClient | null
}

export type SourceParser = (source: InfoSource, context: ParserContext) => Promise<TimelineItemDraft[]>

export type SourceRunResult = {
  sourceId: string
  label: string
  kind: string
  status: 'success' | 'failed'
  fetched: number
  inserted: number
  updated: number
  unchanged: number
  error?: string
}

export type TimelineRunResult = {
  skipped: boolean
  runId?: string
  status?: 'success' | 'partial' | 'failed'
  results: SourceRunResult[]
}

const USER_AGENT = 'cidao-inzai-disaster-map/1.0'
const BODY_MAX_CHARS = 600
const DETAIL_FETCH_LIMIT = 30

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

export function contentHash(title: string, body: string) {
  return createHash('sha256').update(`${title}${body}`, 'utf8').digest('hex')
}

function configString(source: InfoSource, key: string, fallback = '') {
  const value = source.config?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function stringValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  return ''
}

function pad2(value: number | string) {
  return String(value).padStart(2, '0')
}

// 元号→西暦（令和のみ対応。平成以前の発表は対象外）
const ERA_BASE: Record<string, number> = { '令和': 2018, 'R': 2018, 'Ｒ': 2018 }

/**
 * 日本語の日付表現を JST の ISO 文字列へ変換する。
 * 対応: 令和8年8月23日 / 2026年8月23日 / 2026-08-23 / 2026/08/23（任意で 10:30 等の時刻）
 * 解釈できなければ null。
 */
export function parseJapaneseDate(text: string): string | null {
  const normalized = text.normalize('NFKC').trim()
  let year: number | null = null
  let month = 0
  let day = 0
  let rest = ''
  const era = normalized.match(/(令和|R)\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(.*)$/)
  if (era) {
    const eraYear = era[2] === '元' ? 1 : Number(era[2])
    year = ERA_BASE[era[1]] + eraYear
    month = Number(era[3])
    day = Number(era[4])
    rest = era[5] ?? ''
  } else {
    const western = normalized.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?(.*)$/)
    if (!western) return null
    year = Number(western[1])
    month = Number(western[2])
    day = Number(western[3])
    rest = western[4] ?? ''
  }
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  let hour = 0
  let minute = 0
  const time = rest.match(/(\d{1,2})\s*[:時]\s*(\d{1,2})/)
  if (time) {
    hour = Number(time[1])
    minute = Number(time[2])
  }
  return toJstIso(year, month, day, hour, minute)
}

function toJstIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const date = new Date(`${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+09:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * タイムゾーン表記のない日時（印西市防災速報の control.DateTime 等）を JST として解釈する。
 * すでにタイムゾーン付きならそのまま ISO 化する。
 */
export function toIsoAsJst(value: string | null | undefined, fallback = new Date()): string {
  const text = stringValue(value)
  if (!text) return fallback.toISOString()
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const m = text.normalize('NFKC').match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})日?(?:[T\s]+(\d{1,2})[:時](\d{1,2})(?::(\d{1,2}))?)?/)
  if (m) {
    const iso = toJstIso(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0))
    if (iso) return iso
  }
  const direct = parseJapaneseDate(text)
  if (direct) return direct
  return fallback.toISOString()
}

function truncate(text: string, max = BODY_MAX_CHARS) {
  const compact = text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

async function fetchText(url: string, accept = 'text/html,*/*;q=0.8') {
  const response = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return response.text()
}

/** Error でも Supabase の PostgrestError（plain object）でも読める文言にする */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; details?: unknown; code?: unknown; hint?: unknown }
    const parts = [e.message, e.details, e.hint].filter((v) => typeof v === 'string' && v).map(String)
    if (parts.length) return `${parts.join(' / ')}${typeof e.code === 'string' ? ` (${e.code})` : ''}`
    try { return JSON.stringify(error) } catch { /* fallthrough */ }
  }
  return String(error)
}

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return response.json() as Promise<T>
}

function resolveUrl(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// city-category-html: 印西市 防災ポータルのカテゴリ一覧ページ
// ---------------------------------------------------------------------------

type ListingEntry = { date: string; href: string; title: string }

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const DATE_PATTERN = /(令和\s*(?:\d{1,2}|元)\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*[年\/\-]\s*\d{1,2}\s*[月\/\-]\s*\d{1,2}\s*日?)/g
const ANCHOR_PATTERN = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i

/**
 * 一覧ページから「日付＋リンク」の組を抜き出す。
 * 1) <li> 内に <a href> と日付テキストが同居する構造（現行の印西市サイト: <a>題名</a><span class="date">[日付]</span>）
 * 2) 予備: 日付テキストの直後 150 文字以内に現れる <a href>
 * の順に試し、重複は href で除く。
 */
export function extractListingEntries(html: string): ListingEntry[] {
  const seen = new Set<string>()
  const entries: ListingEntry[] = []
  const push = (entry: ListingEntry) => {
    if (!entry.href || seen.has(entry.href)) return
    seen.add(entry.href)
    entries.push(entry)
  }

  const root = parseHtml(html)
  for (const li of root.querySelectorAll('li')) {
    const anchor = li.querySelector('a[href]')
    if (!anchor) continue
    const dateMatch = decodeEntities(li.text).match(DATE_PATTERN)
    if (!dateMatch) continue
    push({ date: dateMatch[0], href: anchor.getAttribute('href') ?? '', title: anchor.text.trim() })
  }

  if (entries.length === 0) {
    const decoded = decodeEntities(html)
    for (const match of decoded.matchAll(DATE_PATTERN)) {
      const after = decoded.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 150)
      const anchor = after.match(ANCHOR_PATTERN)
      if (!anchor) continue
      push({ date: match[0], href: anchor[1], title: anchor[2].replace(/<[^>]+>/g, '').trim() })
    }
  }
  return entries
}

const cityCategoryHtml: SourceParser = async (source) => {
  const baseUrl = configString(source, 'baseUrl', source.url)
  const bodySelector = configString(source, 'bodySelector', '.mol_contents')
  const html = await fetchText(source.url)
  const entries = extractListingEntries(html)

  const drafts: TimelineItemDraft[] = []
  for (const entry of entries.slice(0, DETAIL_FETCH_LIMIT)) {
    // 相対パス（./../0000022367.html 等）は HTML の規則どおり一覧ページ URL 基準で解決し、
    // 404 のときだけ config.baseUrl 基準の候補を試す（市サイトは一覧が /bousaiportal/category/ 配下にある）。
    const candidates = Array.from(new Set(
      [resolveUrl(entry.href, source.url), resolveUrl(entry.href, baseUrl)]
        .filter((value): value is string => Boolean(value) && /^https?:/.test(value as string)),
    ))
    if (candidates.length === 0) continue
    const occurredAt = parseJapaneseDate(entry.date)
    if (!occurredAt) continue
    let absolute = candidates[0]
    let body = ''
    let title = entry.title
    // 外部サイト（気象庁等）へのリンクは本文取得せず、一覧の題名のみ記録する
    const sameHost = (() => {
      try { return new URL(absolute).host === new URL(baseUrl).host } catch { return false }
    })()
    if (sameHost) {
      let lastError: unknown = null
      for (const candidate of candidates) {
        try {
          const detail = parseHtml(await fetchText(candidate))
          const node = detail.querySelector(bodySelector)
          body = truncate(node?.structuredText ?? node?.text ?? '')
          if (!title) title = detail.querySelector('h1')?.text.trim() || detail.querySelector('title')?.text.trim() || candidate
          absolute = candidate
          lastError = null
          break
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) body = `（本文取得失敗: ${errorMessage(lastError)}）`
    }
    drafts.push({
      externalKey: absolute,
      occurredAt,
      title: title || absolute,
      body,
      url: absolute,
      areaTag: '印西市',
      raw: { listingDate: entry.date, href: entry.href },
    })
  }
  return drafts
}

// ---------------------------------------------------------------------------
// city-alert-xml: 印西市 防災行政無線（防災速報）
// ---------------------------------------------------------------------------

const cityAlertXml: SourceParser = async (source) => {
  const updates = await fetchOfficialUpdates({
    indexUrl: source.url || undefined,
    baseUrl: configString(source, 'baseUrl') || undefined,
  })
  return updates.map((update, index) => {
    const occurredAt = toIsoAsJst(update.publishedAt)
    return {
      externalKey: `${update.publishedAt || occurredAt}:${index}:${update.title}`,
      occurredAt,
      title: update.title || '防災行政無線 放送内容',
      body: truncate(update.message),
      url: update.sourceUrl,
      areaTag: '印西市',
      priority: 1,
      raw: { publishedAt: update.publishedAt },
    }
  })
}

// ---------------------------------------------------------------------------
// jma-warning: 気象庁 警報・注意報（印西市）
// ---------------------------------------------------------------------------

// inzai-disaster-map/app.js の weatherWarningDefinitions から移植
export const JMA_WARNING_NAMES: Record<string, string> = {
  '33': 'レベル5大雨特別警報',
  '43': 'レベル4大雨危険警報',
  '03': 'レベル3大雨警報',
  '10': 'レベル2大雨注意報',
  '39': 'レベル5土砂災害特別警報',
  '49': 'レベル4土砂災害危険警報',
  '09': 'レベル3土砂災害警報',
  '29': 'レベル2土砂災害注意報',
  '38': 'レベル5高潮特別警報',
  '48': 'レベル4高潮危険警報',
  '08': 'レベル3高潮警報',
  '19': 'レベル2高潮注意報',
  '35': '暴風特別警報',
  '05': '暴風警報',
  '15': '強風注意報',
  '32': '暴風雪特別警報',
  '02': '暴風雪警報',
  '13': '風雪注意報',
  '36': '大雪特別警報',
  '06': '大雪警報',
  '12': '大雪注意報',
  '37': '波浪特別警報',
  '07': '波浪警報',
  '16': '波浪注意報',
  '14': '雷注意報',
  '17': '融雪注意報',
  '20': '濃霧注意報',
  '21': '乾燥注意報',
  '22': 'なだれ注意報',
  '23': '低温注意報',
  '24': '霜注意報',
  '25': '着氷注意報',
  '26': '着雪注意報',
}

export function jmaWarningName(code: string) {
  const key = String(code).padStart(2, '0')
  return JMA_WARNING_NAMES[key] ?? `気象警報・注意報（コード${key}）`
}

type JmaWarningKind = { code?: string; status?: string; condition?: string }
type JmaWarningArea = { code?: string; areaCode?: string; kinds?: JmaWarningKind[]; warnings?: JmaWarningKind[] }
type JmaWarningReport = {
  reportDatetime?: string
  headlineText?: string
  publishingOffice?: string
  infoType?: string
  areaTypes?: Array<{ areas?: JmaWarningArea[] }>
  warning?: Record<string, JmaWarningArea[] | undefined>
}

const CANCEL_STATUS = /解除|発表警報・注意報はなし|発表なし/

function findWarningArea(report: JmaWarningReport, areaCode: string): JmaWarningArea | null {
  // 現行形式: report.warning.class20Items[] / 仕様書記載形式: report.areaTypes[].areas[]
  for (const list of Object.values(report.warning ?? {})) {
    const hit = (list ?? []).find((area) => String(area.areaCode ?? area.code ?? '') === areaCode)
    if (hit) return hit
  }
  for (const type of report.areaTypes ?? []) {
    const hit = (type.areas ?? []).find((area) => String(area.code ?? area.areaCode ?? '') === areaCode)
    if (hit) return hit
  }
  return null
}

const jmaWarning: SourceParser = async (source) => {
  const areaCode = configString(source, 'areaCode', '1223100')
  const payload = await fetchJson<JmaWarningReport[] | JmaWarningReport>(source.url)
  const reports = Array.isArray(payload) ? payload : [payload]
  const drafts: TimelineItemDraft[] = []
  for (const report of reports) {
    const area = findWarningArea(report, areaCode)
    if (!area) continue
    const kinds = area.kinds ?? area.warnings ?? []
    const active = kinds.filter((kind) => kind.code && !CANCEL_STATUS.test(String(kind.status ?? '')))
    const cancelled = kinds.filter((kind) => CANCEL_STATUS.test(String(kind.status ?? '')))
    const names = active.map((kind) => `${jmaWarningName(String(kind.code))}${kind.status ? `（${kind.status}）` : ''}`)
    const isCancel = active.length === 0
    const title = isCancel
      ? `印西市：発表中の警報・注意報なし${cancelled.length ? '（解除）' : ''}`
      : `印西市：${names.join('、')}`
    const reportDatetime = stringValue(report.reportDatetime)
    drafts.push({
      externalKey: `${reportDatetime}${areaCode}`,
      occurredAt: toIsoAsJst(reportDatetime),
      title,
      body: truncate(stringValue(report.headlineText)),
      url: `https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=${areaCode}`,
      areaTag: '印西市',
      changeType: isCancel ? 'cancel' : undefined,
      priority: active.length ? 2 : 0,
      raw: { publishingOffice: report.publishingOffice, infoType: report.infoType, kinds },
    })
    // 仕様: 配列の先頭が最新。履歴が複数あっても先頭の 1 件だけ採る
    break
  }
  return drafts
}

// ---------------------------------------------------------------------------
// jma-overview: 気象庁 天気概況（千葉県）
// ---------------------------------------------------------------------------

type JmaOverview = { publishingOffice?: string; reportDatetime?: string; targetArea?: string; headlineText?: string; text?: string }

const jmaOverview: SourceParser = async (source) => {
  const data = await fetchJson<JmaOverview>(source.url)
  const reportDatetime = stringValue(data.reportDatetime)
  if (!reportDatetime) return []
  const headline = stringValue(data.headlineText)
  return [{
    externalKey: reportDatetime,
    occurredAt: toIsoAsJst(reportDatetime),
    title: `${stringValue(data.targetArea) || '千葉県'}の天気概況${headline ? `：${headline}` : ''}`,
    body: truncate(stringValue(data.text), 1200),
    url: 'https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=120000',
    areaTag: '千葉県',
    raw: { publishingOffice: data.publishingOffice },
  }]
}

// ---------------------------------------------------------------------------
// jma-quake: 気象庁 地震情報
// ---------------------------------------------------------------------------

type JmaQuakeListEntry = {
  eid?: string
  ttl?: string
  ift?: string
  at?: string
  rdt?: string
  anm?: string
  mag?: string
  maxi?: string
  json?: string
  int?: Array<{ code?: string; maxi?: string; city?: Array<{ code?: string; maxi?: string }> }>
}

type JmaQuakeDetail = {
  Head?: { Headline?: { Text?: string } }
  Body?: { Comments?: { ForecastComment?: { Text?: string } } }
}

const QUAKE_LIST_LIMIT = 10

const jmaQuake: SourceParser = async (source) => {
  const cityCode = configString(source, 'cityCode', '1223100')
  const detailBase = configString(source, 'detailBase', 'https://www.jma.go.jp/bosai/quake/data/')
  const list = await fetchJson<JmaQuakeListEntry[]>(source.url)
  const kept = (Array.isArray(list) ? list : []).filter((entry) => {
    const ttl = stringValue(entry.ttl)
    if (!(ttl.includes('震源') && ttl.includes('震度'))) return false
    if (stringValue(entry.ift) === '取消') return false
    const cities = (entry.int ?? []).flatMap((pref) => pref.city ?? [])
    return cities.some((city) => stringValue(city.code) === cityCode) || stringValue(entry.anm).includes('千葉')
  }).slice(0, QUAKE_LIST_LIMIT)

  const drafts: TimelineItemDraft[] = []
  for (const entry of kept) {
    const eid = stringValue(entry.eid)
    if (!eid) continue
    const cityIntensity = (entry.int ?? [])
      .flatMap((pref) => pref.city ?? [])
      .find((city) => stringValue(city.code) === cityCode)?.maxi
    let headline = ''
    let tsunami = ''
    if (entry.json && /^[a-zA-Z0-9_.-]+\.json$/.test(entry.json)) {
      try {
        const detail = await fetchJson<JmaQuakeDetail>(`${detailBase}${entry.json}`)
        headline = stringValue(detail.Head?.Headline?.Text)
        tsunami = stringValue(detail.Body?.Comments?.ForecastComment?.Text)
      } catch (error) {
        headline = `（詳細取得失敗: ${errorMessage(error)}）`
      }
    }
    const mag = stringValue(entry.mag)
    const title = `地震情報：${stringValue(entry.anm) || '震源不明'}${mag ? ` M${mag}` : ''} 印西市の震度 ${cityIntensity ? stringValue(cityIntensity) : '観測なし'}（最大震度 ${stringValue(entry.maxi) || '-'}）`
    drafts.push({
      externalKey: eid,
      occurredAt: toIsoAsJst(stringValue(entry.at) || stringValue(entry.rdt)),
      title,
      body: truncate([headline, tsunami].filter(Boolean).join('\n')),
      url: 'https://www.jma.go.jp/bosai/quake/',
      areaTag: cityIntensity ? '印西市' : '千葉県',
      priority: cityIntensity ? 2 : 1,
      raw: { eid, ttl: entry.ttl, ift: entry.ift, anm: entry.anm, mag, maxi: entry.maxi, cityIntensity: cityIntensity ?? null },
    })
  }
  return drafts
}

// ---------------------------------------------------------------------------
// sns-priority: 市長・市公式SNS（disaster_sns_candidates の priority_label 付き投稿）
// ---------------------------------------------------------------------------

const snsPriority: SourceParser = async (_source, context) => {
  if (!context.supabase) throw new Error('sns-priority は DB 接続が必要です')
  const { data, error } = await context.supabase
    .from('disaster_sns_candidates')
    .select('external_id, platform, permalink, body_text, posted_at, author_username, raw_payload')
    .not('raw_payload->>priority_label', 'is', null)
    .neq('review_status', 'dismissed')
    .order('posted_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []).flatMap((row) => {
    const label = stringValue((row.raw_payload as { priority_label?: string } | null)?.priority_label)
    if (!label) return []
    return [{
      externalKey: `${row.platform}:${row.external_id}`,
      occurredAt: toIsoAsJst(row.posted_at),
      title: `${label}の投稿`,
      body: truncate(stringValue(row.body_text)),
      url: stringValue(row.permalink) || null,
      areaTag: '印西市',
      priority: 1,
      raw: { platform: row.platform, username: row.author_username },
    }]
  })
}

// ---------------------------------------------------------------------------
// manual: 自動取得なし（管理画面から直接登録）
// ---------------------------------------------------------------------------

const manual: SourceParser = async () => []

// ---------------------------------------------------------------------------
// パーサ表
// ---------------------------------------------------------------------------

export const PARSERS: Record<string, SourceParser> = {
  'city-category-html': cityCategoryHtml,
  'city-alert-xml': cityAlertXml,
  'jma-warning': jmaWarning,
  'jma-overview': jmaOverview,
  'jma-quake': jmaQuake,
  'sns-priority': snsPriority,
  manual,
}

export const SOURCE_KINDS: Array<{ id: string; label: string; help: string }> = [
  { id: 'city-category-html', label: '市サイト カテゴリ一覧（HTML）', help: 'config: baseUrl, bodySelector（既定 .mol_contents）' },
  { id: 'city-alert-xml', label: '市 防災速報（XML）', help: 'config: baseUrl' },
  { id: 'jma-warning', label: '気象庁 警報・注意報', help: 'config: areaCode（印西市 1223100）' },
  { id: 'jma-overview', label: '気象庁 天気概況', help: 'config なし' },
  { id: 'jma-quake', label: '気象庁 地震情報', help: 'config: cityCode, detailBase' },
  { id: 'sns-priority', label: '市長・市公式SNS（巡回結果から）', help: 'URL・config なし。SNS巡回の priority_label 付き投稿を取り込む' },
  { id: 'manual', label: '手動登録', help: '自動取得なし。管理画面から項目を直接追加する' },
]

export function isKnownKind(kind: string) {
  return Object.prototype.hasOwnProperty.call(PARSERS, kind)
}

/** DB には書かず、パーサを実行して結果だけ返す（管理画面の「テスト取得」用） */
export async function testFetchSource(source: InfoSource, context: ParserContext) {
  const parser = PARSERS[source.kind]
  if (!parser) throw new Error(`未対応の種別です: ${source.kind}`)
  return parser(source, context)
}

// ---------------------------------------------------------------------------
// 保存（source_id + external_key で upsert、content_hash 差分で update 判定）
// ---------------------------------------------------------------------------

export async function upsertTimelineItems(
  supabase: SupabaseClient,
  source: InfoSource,
  drafts: TimelineItemDraft[],
) {
  const counts = { inserted: 0, updated: 0, unchanged: 0 }
  // 同じ external_key が1バッチに複数あると2件目の insert がユニーク制約に当たる
  // （気象庁の地震一覧は同じ eid の続報が並ぶ）。先頭＝最新を採用して重複を落とす
  const seen = new Set<string>()
  drafts = drafts.filter((draft) => {
    if (!draft.externalKey || seen.has(draft.externalKey)) return false
    seen.add(draft.externalKey)
    return true
  })
  if (drafts.length === 0) return counts
  const keys = Array.from(seen)
  const { data: existingRows, error: existingError } = await supabase
    .from('disaster_timeline_items')
    .select('id, external_key, content_hash')
    .eq('source_id', source.id)
    .in('external_key', keys)
  if (existingError) throw existingError
  const existing = new Map((existingRows ?? []).map((row) => [row.external_key as string, row]))
  const now = new Date().toISOString()

  for (const draft of drafts) {
    const hash = contentHash(draft.title, draft.body)
    const current = existing.get(draft.externalKey)
    if (current && current.content_hash === hash) {
      counts.unchanged += 1
      continue
    }
    const common = {
      occurred_at: draft.occurredAt,
      title: draft.title,
      body: draft.body,
      url: draft.url,
      area_tag: draft.areaTag,
      priority: draft.priority ?? 0,
      content_hash: hash,
      raw: draft.raw ?? {},
      fetched_at: now,
      updated_at: now,
    }
    if (current) {
      const { error } = await supabase
        .from('disaster_timeline_items')
        .update({ ...common, change_type: draft.changeType ?? 'update' })
        .eq('id', current.id)
      if (error) throw error
      counts.updated += 1
    } else {
      const { error } = await supabase
        .from('disaster_timeline_items')
        .insert({
          ...common,
          source_id: source.id,
          external_key: draft.externalKey,
          change_type: draft.changeType ?? 'new',
          first_seen_at: now,
        })
      if (error) throw error
      counts.inserted += 1
    }
  }
  return counts
}

export function toInfoSource(row: Record<string, unknown>): InfoSource {
  return {
    id: String(row.id),
    kind: String(row.kind ?? ''),
    label: String(row.label ?? ''),
    url: String(row.url ?? ''),
    config: (row.config && typeof row.config === 'object' ? row.config : {}) as Record<string, unknown>,
    trust: (['official', 'semi-official', 'unverified'].includes(String(row.trust)) ? row.trust : 'unverified') as SourceTrust,
    enabled: Boolean(row.enabled),
  }
}

/**
 * 有効な情報源を順に巡回して保存する。1 つの情報源の失敗は last_error に記録して続行。
 * claim=true のときは app_settings ベースの 4 分クレームで多重実行を防ぐ（cron 用）。
 */
export async function runDisasterTimeline(
  supabase: SupabaseClient,
  options: { claim?: boolean; minIntervalSeconds?: number } = {},
): Promise<TimelineRunResult> {
  if (options.claim) {
    const { data: claimed, error: claimError } = await supabase.rpc('claim_disaster_timeline_run', {
      p_min_interval_seconds: options.minIntervalSeconds ?? 240,
    })
    if (claimError) throw claimError
    if (!claimed) return { skipped: true, results: [] }
  }

  const startedAt = new Date().toISOString()
  const { data: run, error: runError } = await supabase
    .from('disaster_timeline_runs')
    .insert({ started_at: startedAt, status: 'running' })
    .select('id')
    .single()
  if (runError) throw runError

  const { data: rows, error: rowsError } = await supabase
    .from('disaster_info_sources')
    .select('id, kind, label, url, config, trust, enabled')
    .eq('enabled', true)
    .order('sort_order')
    .order('created_at')
  if (rowsError) throw rowsError

  const results: SourceRunResult[] = []
  for (const row of rows ?? []) {
    const source = toInfoSource(row as Record<string, unknown>)
    const fetchedAt = new Date().toISOString()
    try {
      const parser = PARSERS[source.kind]
      if (!parser) throw new Error(`未対応の種別です: ${source.kind}`)
      const drafts = await parser(source, { supabase })
      const counts = await upsertTimelineItems(supabase, source, drafts)
      results.push({ sourceId: source.id, label: source.label, kind: source.kind, status: 'success', fetched: drafts.length, ...counts })
      await supabase.from('disaster_info_sources').update({
        last_fetched_at: fetchedAt,
        last_status: 'success',
        last_error: null,
        updated_at: fetchedAt,
      }).eq('id', source.id)
    } catch (error) {
      const message = errorMessage(error)
      results.push({ sourceId: source.id, label: source.label, kind: source.kind, status: 'failed', fetched: 0, inserted: 0, updated: 0, unchanged: 0, error: message })
      await supabase.from('disaster_info_sources').update({
        last_fetched_at: fetchedAt,
        last_status: 'failed',
        last_error: message.slice(0, 1000),
        updated_at: fetchedAt,
      }).eq('id', source.id)
    }
  }

  const failed = results.filter((result) => result.status === 'failed').length
  const status: TimelineRunResult['status'] = failed === 0 ? 'success' : failed === results.length && results.length > 0 ? 'failed' : 'partial'
  await supabase.from('disaster_timeline_runs').update({
    finished_at: new Date().toISOString(),
    status,
    result: { results },
    error_message: failed ? results.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`).join('\n').slice(0, 2000) : null,
  }).eq('id', run.id)

  return { skipped: false, runId: String(run.id), status, results }
}
