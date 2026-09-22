// 防災MAP「🚧 通行止め（役所の発表）」の取り込み。
//
// 情報源は役所の公式ページだけ（2026-09-22 事業主決定）。災害タイムラインの巡回（disaster-timeline.ts）が
// kind road-closure-kokudo / road-closure-pref / road-closure-inzai の情報源に来たとき、ここの scan を呼び、
// 「いま通行止めの件」の一覧を返す。保存と解除（syncRoadClosures）は巡回だけが行う（テスト取得は DB に書かない）。
//
// 解除は「解除の発表が出た（announced）」か「見張るページから消えた（disappeared）」。ただし
// 取得に失敗した・ページの形が変わって読めないときは例外を投げ、何も解除しない
// （市のサイトの不具合だけで全件が「復旧」にならないように）。
//
// 役所のサイトはどこも無断転用を認めていない（千葉国道事務所だけ PDL1.0）。文章は写さず、
// 路線名・場所・理由・発表日という事実だけを取り出して持つ。調査は保管庫
// cidao/2026-09-22_通行止め情報源の調査_規約と位置表記.md

import { parse as parseHtml } from 'node-html-parser'
import type { SupabaseClient } from '@supabase/supabase-js'

export const ROAD_CLOSURE_KINDS = ['road-closure-kokudo', 'road-closure-pref', 'road-closure-inzai'] as const
export type RoadClosureKind = (typeof ROAD_CLOSURE_KINDS)[number]

export function isRoadClosureKind(kind: string): kind is RoadClosureKind {
  return (ROAD_CLOSURE_KINDS as readonly string[]).includes(kind)
}

export type ClosureSource = {
  id: string
  kind: string
  label: string
  url: string
  config: Record<string, unknown>
}

export type ClosureDraft = {
  key: string
  road: string
  place: string
  reason: string
  municipality: string
  inArea: boolean
  url: string | null
  sourceTitle: string
  publishedAt: string | null
  raw?: Record<string, unknown>
}

export type ClearReason = 'announced' | 'disappeared'

export type ClosureScan = {
  active: ClosureDraft[]
  /** 今回の読み取りで解除と分かった鍵と理由。active に無い既存行は、ここに無ければ disappeared として解除する */
  cleared: Record<string, ClearReason>
  notes: string[]
}

/** DB に既にある行（読むだけ。解除の判定と、周辺かどうかの判定結果の使い回しに使う） */
export type ExistingClosure = {
  closure_key: string
  url: string | null
  in_area: boolean
  cleared_at: string | null
  clear_reason: string | null
  raw: Record<string, unknown> | null
}

const USER_AGENT = 'cidao-inzai-disaster-map/1.0'

// 印西市とその周辺（通勤で通る道）。千葉県の記事の市町村名がこれを含めば周辺とみなす
const DEFAULT_AREAS = '印西,白井,栄町,成田,佐倉,八千代,我孫子,柏,酒々井,富里,船橋,鎌ケ谷,鎌ヶ谷,松戸,流山,野田'

function configString(source: ClosureSource, key: string, fallback = '') {
  const value = source.config?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function configList(source: ClosureSource, key: string, fallback: string) {
  return configString(source, key, fallback).split(',').map((v) => v.trim()).filter(Boolean)
}

type FetchResult = { ok: true; status: number; text: string } | { ok: false; status: number; text: '' }

async function fetchPage(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,*/*;q=0.8', 'User-Agent': USER_AGENT },
    cache: 'no-store',
  })
  if (!response.ok) return { ok: false, status: response.status, text: '' }
  return { ok: true, status: response.status, text: await response.text() }
}

async function fetchRequired(url: string) {
  const result = await fetchPage(url)
  if (!result.ok) throw new Error(`HTTP ${result.status}: ${url}`)
  return result.text
}

function clean(text: string) {
  return text
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 比較用に正規化（全角→半角・空白除去・読みがなの括弧を除く） */
export function normalizeKey(text: string) {
  return text.normalize('NFKC').replace(/\([ぁ-ゖー]+\)/g, '').replace(/\s+/g, '')
}

function resolve(href: string, base: string) {
  try { return new URL(href, base).toString() } catch { return null }
}

/** 「2026年09月22日」「令和8年9月21日」を JST の日付（ISO）にする。時刻は持たない */
export function parseJpDate(text: string): string | null {
  const s = text.normalize('NFKC')
  let m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00+09:00`
  m = s.match(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (m) {
    const year = 2018 + (m[1] === '元' ? 1 : Number(m[1]))
    return `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00+09:00`
  }
  return null
}

/** 題名から理由の短い言葉を作る（役所の文を写さず、種類だけを持つ） */
export function reasonOf(text: string) {
  const s = text.normalize('NFKC')
  if (/冠水/.test(s)) return '道路冠水'
  if (/陥没/.test(s)) return '道路陥没'
  if (/土砂|崩落|法面|のり面|落石/.test(s)) return '土砂・のり面の崩れ'
  if (/倒木/.test(s)) return '倒木'
  if (/大雨|豪雨|台風/.test(s)) return '大雨'
  if (/地震/.test(s)) return '地震'
  if (/工事|補修|修繕/.test(s)) return '工事'
  return ''
}

// ---------------------------------------------------------------------------
// 千葉国道事務所 記者発表（https://www.ktr.mlit.go.jp/kisha/chiba_index.html）
// ---------------------------------------------------------------------------
// 題名が「大雨による通行止めのお知らせ【第1報】～国道16号 村田町アンダーパス～」と
// 「大雨による通行止め解除のお知らせ【終報】～国道16号 村田町アンダーパス～」の対になる。
// 同じ「路線＋区間」について、最後の発表が通行止めなら通行止め中。題名に市の名前が無いので、
// 周辺かどうかは路線番号で決める（config.routes・既定 16,6）。

type KokudoEntry = { date: string | null; title: string; url: string | null }

export function parseKokudoList(html: string, baseUrl: string): KokudoEntry[] {
  const root = parseHtml(html)
  const items = root.querySelectorAll('li.kisha_list li')
  return items.map((li) => {
    const anchor = li.querySelector('a')
    const title = clean((anchor?.innerHTML ?? '').replace(/\[PDF[^\]]*\]/g, ''))
    const href = anchor?.getAttribute('href') ?? ''
    return {
      date: parseJpDate(li.querySelector('.date')?.text ?? ''),
      title,
      url: href ? resolve(href, baseUrl) : null,
    }
  }).filter((entry) => entry.title)
}

export function kokudoClosureOf(title: string) {
  const s = title.normalize('NFKC')
  if (!/通行止/.test(s)) return null
  const route = s.match(/国道\s*(\d+)\s*号/)
  if (!route) return null
  const between = s.match(/[～〜~]([^～〜~]+)[～〜~]/)
  const place = between
    ? between[1].replace(/国道\s*\d+\s*号(?:バイパス)?/, '').replace(/\([ぁ-ゖー]+\)/g, '').replace(/\s+/g, ' ').trim()
    : ''
  const cleared = /解除/.test(s)
  return {
    route: route[1],
    road: `国道${route[1]}号`,
    place,
    cleared,
    reason: reasonOf(s.split(/による|に伴う/)[0] ?? ''),
    key: normalizeKey(`国道${route[1]}号|${place}`),
  }
}

export async function scanKokudo(source: ClosureSource): Promise<ClosureScan> {
  const url = source.url || 'https://www.ktr.mlit.go.jp/kisha/chiba_index.html'
  const entries = parseKokudoList(await fetchRequired(url), url)
  if (!entries.length) throw new Error('記者発表の一覧が読めません（ページの形が変わった可能性）')
  const routes = new Set(configList(source, 'routes', '16,6'))

  // 一覧は新しい順。古い順にたどり、最後の発表で状態を決める
  const state = new Map<string, ClosureDraft>()
  const cleared: Record<string, ClearReason> = {}
  for (const entry of [...entries].reverse()) {
    const info = kokudoClosureOf(entry.title)
    if (!info) continue
    if (info.cleared) {
      state.delete(info.key)
      cleared[info.key] = 'announced'
      continue
    }
    delete cleared[info.key]
    state.set(info.key, {
      key: info.key,
      road: info.road,
      place: info.place,
      reason: info.reason,
      municipality: '',
      inArea: routes.has(info.route),
      url: entry.url,
      sourceTitle: entry.title,
      publishedAt: entry.date,
      raw: { route: info.route },
    })
  }
  return { active: [...state.values()], cleared, notes: [`記者発表 ${entries.length}件を確認`] }
}

// ---------------------------------------------------------------------------
// 千葉県 県管理道路通行規制情報（https://www.pref.chiba.lg.jp/cate/baa/lifeline/kendou/index.html）
// ---------------------------------------------------------------------------
// 一覧の本体は JavaScript で読み込まれる別ファイル（/shared/genrelist/pl_NNNN.html）。
// 通行止め区間（県道 6302・県管理国道 6301）と解除区間（7310・7929）がある。県は通行止めの一覧に
// 解除の記事を残すことがあるため、「一覧から消えた」に加えて「同じ路線・場所の解除記事が後から出た」でも解除する。

const PREF_BASE = 'https://www.pref.chiba.lg.jp/'
const PREF_CLOSURE_LISTS = `${PREF_BASE}shared/genrelist/pl_6302.html,${PREF_BASE}shared/genrelist/pl_6301.html`
const PREF_CLEAR_LISTS = `${PREF_BASE}shared/genrelist/pl_7310.html,${PREF_BASE}shared/genrelist/pl_7929.html`
const PREF_DETAIL_LIMIT = 3

type PrefEntry = { title: string; url: string }

export function parsePrefList(html: string): PrefEntry[] {
  const out: PrefEntry[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolve(m[1], PREF_BASE)
    const title = clean(m[2])
    if (!url || !title || seen.has(url)) continue
    seen.add(url)
    out.push({ title, url })
  }
  return out
}

export function prefRoadOf(title: string) {
  const s = title.normalize('NFKC')
  const road = s.match(/(県道[^（()）、\s]+?線|国道\d+号(?:バイパス)?)/)?.[1] ?? ''
  const place = s.match(/[（(]([^（()）]*?(?:市|町|村)[^（()）]*)[）)]/)?.[1]?.trim() ?? ''
  const municipality = place.match(/^(.+?[市町村])/)?.[1] ?? ''
  return { road, place, municipality }
}

/** 県の記事URLの日付（kisei260807.html・kiseikaijo260918.html の YYMMDD）。題名に日付が無い記事の補い */
export function prefUrlDate(url: string): string | null {
  const m = url.match(/(?:^|[^0-9])(\d{2})(\d{2})(\d{2})\.html$/)
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `20${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`
}

function sameRoadPlace(a: { road: string; place: string }, b: { road: string; place: string }) {
  if (!a.road || !b.road || normalizeKey(a.road) !== normalizeKey(b.road)) return false
  if (!a.place || !b.place) return true
  const pa = normalizeKey(a.place).replace(/地先$/, '')
  const pb = normalizeKey(b.place).replace(/地先$/, '')
  return pa.includes(pb) || pb.includes(pa)
}

export async function scanPref(source: ClosureSource, existing: ExistingClosure[]): Promise<ClosureScan> {
  const areas = configList(source, 'areas', DEFAULT_AREAS)
  const closureLists = configList(source, 'closureLists', PREF_CLOSURE_LISTS)
  const clearLists = configList(source, 'clearLists', PREF_CLEAR_LISTS)

  // 通行止めの一覧が読めないときは何も解除しない（例外で巡回に失敗を記録させる）
  const closureEntries: PrefEntry[] = []
  for (const url of closureLists) closureEntries.push(...parsePrefList(await fetchRequired(url)))
  // 解除の一覧は補助。読めなくても続ける（「一覧から消えた」の判定だけは効く）
  const clearEntries: PrefEntry[] = []
  const notes: string[] = []
  for (const url of clearLists) {
    try { clearEntries.push(...parsePrefList(await fetchRequired(url))) } catch (error) {
      notes.push(`解除一覧を読めませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const clears = [...closureEntries, ...clearEntries]
    .filter((entry) => /解除/.test(entry.title))
    .map((entry) => ({ ...prefRoadOf(entry.title), date: parseJpDate(entry.title) ?? prefUrlDate(entry.url) }))

  const known = new Map(existing.map((row) => [row.closure_key, row]))
  const active: ClosureDraft[] = []
  const cleared: Record<string, ClearReason> = {}
  let detailFetches = 0

  for (const entry of closureEntries) {
    if (/解除/.test(entry.title)) continue
    // 片側交互通行・車線規制は通行止めではないので出さない（県管理国道の一覧に混ざる）
    if (/片側交互|車線規制/.test(entry.title) && !/通行止/.test(entry.title)) continue
    const info = prefRoadOf(entry.title)
    const publishedAt = parseJpDate(entry.title) ?? prefUrlDate(entry.url)
    const announced = clears.some((c) => sameRoadPlace(info, c) && c.date && publishedAt && c.date >= publishedAt)
    if (announced) { cleared[entry.url] = 'announced'; continue }

    // 周辺かどうか：題名の市町村名 → 前回の判定 → 記事本文（1回の巡回で3件まで）
    let inArea: boolean | null = info.municipality ? areas.some((a) => info.municipality.includes(a)) : null
    let municipality = info.municipality
    const prev = known.get(entry.url)
    if (inArea === null && prev && (prev.raw as { areaChecked?: boolean } | null)?.areaChecked) inArea = prev.in_area
    if (inArea === null && detailFetches < PREF_DETAIL_LIMIT) {
      detailFetches += 1
      const page = await fetchPage(entry.url)
      if (page.ok) {
        const text = clean(page.text)
        const hit = areas.find((a) => text.includes(a))
        inArea = Boolean(hit)
        if (hit && !municipality) municipality = hit
      }
    }
    active.push({
      key: entry.url,
      road: info.road,
      place: info.place,
      reason: reasonOf(entry.title),
      municipality,
      inArea: inArea ?? false,
      url: entry.url,
      sourceTitle: entry.title,
      publishedAt,
      raw: { areaChecked: inArea !== null },
    })
  }
  notes.unshift(`通行止め一覧 ${closureEntries.length}件・解除一覧 ${clearEntries.length}件を確認`)
  return { active, cleared, notes }
}

// ---------------------------------------------------------------------------
// 印西市（https://www.city.inzai.lg.jp/）
// ---------------------------------------------------------------------------
// 市は通行止めのたびに記事を1件作り、トップの「新着情報」に載せる。解除のときは同じ記事の題名を
// 「…の通行止めは解除いたしました」に書き換える。災害ごとに「道路の通行止めの状況」という
// まとめページも新しく作る（8月は 0000022373、9月は 0000022578）。
// 解除の判定：(1) 記事の題名に「解除」が入った (2) 記事が消えた（404）
//            (3) まとめページに載っていた記事が、まとめページから消えた（空になった）＝事業主提案 2026-09-22
// 新着から落ちただけでは解除にしない（新着は十数件で押し出されるため）。

const INZAI_TOP = 'https://www.city.inzai.lg.jp/'
const INZAI_DETAIL_LIMIT = 12

export function parseInzaiNews(html: string, baseUrl = INZAI_TOP) {
  const root = parseHtml(html)
  const links = root.querySelectorAll('.new_lower li a, article.new li a')
  const seen = new Set<string>()
  const out: Array<{ title: string; url: string }> = []
  for (const a of links) {
    const url = resolve(a.getAttribute('href') ?? '', baseUrl)
    const title = clean(a.innerHTML)
    if (!url || !title || seen.has(url)) continue
    seen.add(url)
    out.push({ title, url })
  }
  return out
}

/** まとめページ（道路の通行止めの状況）の本文のリンク。本文の枠が無ければ null（読めない＝何も解除しない） */
export function parseInzaiStatusPage(html: string, baseUrl = INZAI_TOP) {
  const root = parseHtml(html)
  const body = root.querySelector('.mol_contents')
  if (!body) return null
  const out: Array<{ title: string; url: string }> = []
  for (const a of body.querySelectorAll('a')) {
    const url = resolve(a.getAttribute('href') ?? '', baseUrl)
    const title = clean(a.innerHTML.replace(/<span class="newwindow">[\s\S]*?<\/span>/g, ''))
    if (url && /\/\d{10}\.html$/.test(url)) out.push({ title, url })
  }
  return out
}

/** 記事の見出し（.mol_contents の h2、無ければ h1）。本文の枠が無ければ null */
export function parseInzaiDetailTitle(html: string) {
  const root = parseHtml(html)
  const body = root.querySelector('.mol_contents')
  if (!body) return null
  return clean(body.querySelector('h2')?.innerHTML ?? root.querySelector('h1')?.innerHTML ?? '')
}

/** 「市道師戸・江川線の一部区間」や「道路冠水により、市道師戸・江川線の一部区間を通行止めに…」から路線と場所 */
export function inzaiRoadOf(text: string) {
  const s = text.normalize('NFKC').replace(/\s+/g, '')
  const m = s.match(/((?:市道|県道|国道)[^、。を]*?(?:線|号))(?:の)?([^、。を]*?)(?:を|$|の通行止|における)/)
  if (m) return { road: m[1], place: m[2].replace(/(?:道路)?冠水による通行止め.*$/, '') }
  const near = s.match(/^([^、。]*?付近)/)
  return { road: '', place: near ? near[1] : '' }
}

export async function scanInzai(source: ClosureSource, existing: ExistingClosure[]): Promise<ClosureScan> {
  const topUrl = source.url || INZAI_TOP
  const news = parseInzaiNews(await fetchRequired(topUrl), topUrl)
  if (!news.length) throw new Error('印西市トップの新着情報が読めません（ページの形が変わった可能性）')

  const notes: string[] = [`新着 ${news.length}件を確認`]
  const known = new Map(existing.map((row) => [row.closure_key, row]))
  const activeRows = existing.filter((row) => !row.cleared_at)

  // まとめページ：config の指定＋新着に出たもの＋前回までに記事が載っていたもの
  const statusUrls = new Set(configList(source, 'statusUrls', ''))
  for (const item of news) if (/通行止めの状況|道路状況/.test(item.title)) statusUrls.add(item.url)
  for (const row of activeRows) {
    const s = (row.raw as { statusUrl?: string } | null)?.statusUrl
    if (s) statusUrls.add(s)
  }
  const statusLists = new Map<string, Array<{ title: string; url: string }>>()
  for (const url of statusUrls) {
    const page = await fetchPage(url)
    const list = page.ok ? parseInzaiStatusPage(page.text, url) : null
    if (list) statusLists.set(url, list)
    else notes.push(`まとめページを読めませんでした（${page.status}）: ${url}`)
  }
  const statusOf = new Map<string, { statusUrl: string; title: string }>()
  for (const [statusUrl, list] of statusLists) {
    for (const item of list) statusOf.set(item.url, { statusUrl, title: item.title })
  }

  // 確かめる記事：新着の通行止め記事＋まとめページの記事＋いま通行止め中の行
  const candidates = new Map<string, string>()
  for (const item of news) if (/通行止/.test(item.title) && !/解除/.test(item.title)) candidates.set(item.url, item.title)
  for (const [url, info] of statusOf) if (!candidates.has(url)) candidates.set(url, info.title)
  for (const row of activeRows) if (row.url && !candidates.has(row.url)) candidates.set(row.url, '')

  const active: ClosureDraft[] = []
  const cleared: Record<string, ClearReason> = {}
  let fetched = 0
  for (const [url, listTitle] of candidates) {
    const prev = known.get(url)
    if (fetched >= INZAI_DETAIL_LIMIT) {
      // 上限を超えた分は前回の状態のまま残す（読めていないものは解除しない）
      if (prev && !prev.cleared_at) active.push(keepAsIs(prev, url))
      continue
    }
    fetched += 1
    const page = await fetchPage(url)
    if (!page.ok) {
      if (page.status === 404 || page.status === 410) { cleared[url] = 'disappeared'; continue }
      if (prev && !prev.cleared_at) active.push(keepAsIs(prev, url))
      notes.push(`記事を読めませんでした（${page.status}）: ${url}`)
      continue
    }
    const title = parseInzaiDetailTitle(page.text)
    if (title === null) {
      if (prev && !prev.cleared_at) active.push(keepAsIs(prev, url))
      notes.push(`記事の形が読めませんでした: ${url}`)
      continue
    }
    if (/解除/.test(title)) { cleared[url] = 'announced'; continue }
    if (!/通行止/.test(title) && !/通行止/.test(listTitle)) { cleared[url] = 'disappeared'; continue }

    const onStatus = statusOf.get(url)
    const prevRaw = (prev?.raw ?? {}) as { statusUrl?: string; onStatus?: boolean }
    const statusUrl = onStatus?.statusUrl ?? prevRaw.statusUrl
    // まとめページに一度載った記事が、読めたまとめページから消えていたら解除（空になった場合も含む）
    if (!onStatus && prevRaw.onStatus && statusUrl && statusLists.has(statusUrl)) {
      cleared[url] = 'disappeared'
      continue
    }
    const nameSource = onStatus?.title || listTitle || title
    const { road, place } = inzaiRoadOf(nameSource)
    const fallback = inzaiRoadOf(title)
    active.push({
      key: url,
      road: road || fallback.road,
      place: place || fallback.place,
      reason: reasonOf(`${title} ${listTitle}`),
      municipality: '印西市',
      inArea: true,
      url,
      sourceTitle: title,
      publishedAt: parseJpDate(listTitle) ?? parseJpDate(title),
      raw: { statusUrl: statusUrl ?? null, onStatus: Boolean(onStatus || prevRaw.onStatus) },
    })
  }
  return { active, cleared, notes }
}

function keepAsIs(prev: ExistingClosure, url: string): ClosureDraft {
  const raw = (prev.raw ?? {}) as Record<string, unknown>
  return {
    key: prev.closure_key,
    road: String(raw.road ?? ''),
    place: String(raw.place ?? ''),
    reason: String(raw.reason ?? ''),
    municipality: '印西市',
    inArea: prev.in_area,
    url,
    sourceTitle: '',
    publishedAt: null,
    raw: { ...raw, keptAsIs: true },
  }
}

// ---------------------------------------------------------------------------
// 共通：読む・保存する
// ---------------------------------------------------------------------------

export async function loadExistingClosures(supabase: SupabaseClient | null, sourceId: string): Promise<ExistingClosure[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('disaster_road_closures')
    .select('closure_key, url, in_area, cleared_at, clear_reason, raw')
    .eq('source_id', sourceId)
  if (error) throw error
  return (data ?? []) as ExistingClosure[]
}

export async function scanRoadClosures(source: ClosureSource, existing: ExistingClosure[]): Promise<ClosureScan> {
  if (source.kind === 'road-closure-kokudo') return scanKokudo(source)
  if (source.kind === 'road-closure-pref') return scanPref(source, existing)
  if (source.kind === 'road-closure-inzai') return scanInzai(source, existing)
  throw new Error(`未対応の種別です: ${source.kind}`)
}

/**
 * 読み取り結果を disaster_road_closures へ反映する（巡回だけが呼ぶ）。
 * - active の件：無ければ追加、あれば最終確認時刻と中身を更新（解除済みなら通行止めに戻す。運営が解除した行は戻さない）
 * - DB で通行止め中なのに active に無い件：解除（理由は scan.cleared、無ければ disappeared）
 */
export async function syncRoadClosures(supabase: SupabaseClient, sourceId: string, scan: ClosureScan, existing: ExistingClosure[]) {
  const now = new Date().toISOString()
  const known = new Map(existing.map((row) => [row.closure_key, row]))
  const seen = new Set<string>()
  let inserted = 0
  let updated = 0
  let cleared = 0

  for (const draft of scan.active) {
    seen.add(draft.key)
    const prev = known.get(draft.key)
    if (prev?.clear_reason === 'operator') continue
    // 前回の中身を持ち越す（上限などで読めなかった回に空で上書きしない）
    const kept = Boolean(draft.raw?.keptAsIs)
    const raw = { ...(prev?.raw ?? {}), ...(draft.raw ?? {}), road: draft.road, place: draft.place, reason: draft.reason }
    const fields = kept
      ? { last_seen_at: now, updated_at: now }
      : {
          road: draft.road,
          place: draft.place,
          reason: draft.reason,
          municipality: draft.municipality,
          in_area: draft.inArea,
          url: draft.url,
          source_title: draft.sourceTitle,
          published_at: draft.publishedAt,
          last_seen_at: now,
          updated_at: now,
          raw,
        }
    if (!prev) {
      const { error } = await supabase.from('disaster_road_closures').insert({
        source_id: sourceId,
        closure_key: draft.key,
        first_seen_at: now,
        ...fields,
      })
      if (error) throw error
      inserted += 1
      continue
    }
    const { error } = await supabase
      .from('disaster_road_closures')
      .update(prev.cleared_at ? { ...fields, cleared_at: null, clear_reason: null } : fields)
      .eq('source_id', sourceId)
      .eq('closure_key', draft.key)
    if (error) throw error
    updated += 1
  }

  for (const row of existing) {
    if (row.cleared_at || seen.has(row.closure_key)) continue
    const { error } = await supabase
      .from('disaster_road_closures')
      .update({ cleared_at: now, clear_reason: scan.cleared[row.closure_key] ?? 'disappeared', updated_at: now })
      .eq('source_id', sourceId)
      .eq('closure_key', row.closure_key)
    if (error) throw error
    cleared += 1
  }
  return { inserted, updated, cleared }
}
