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

export const ROAD_CLOSURE_KINDS = ['road-closure-kokudo', 'road-closure-pref', 'road-closure-inzai', 'road-closure-inba', 'road-closure-mymap', 'road-closure-sugumail'] as const
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
  if (/土砂|崩落|崩壊|がけ崩れ|崖崩れ|法面|のり面|落石/.test(s)) return '土砂・のり面の崩れ'
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

/** 記事に添付された位置図（PDF）。通行止め区間を赤線で描いた市の地図で、地図に線を引けない件の場所の手がかりになる */
export function parseInzaiMapPdf(html: string, baseUrl: string) {
  const root = parseHtml(html)
  const body = root.querySelector('.mol_contents')
  if (!body) return null
  for (const a of body.querySelectorAll('.mol_attachfileblock a, a')) {
    const href = a.getAttribute('href') ?? ''
    if (/\.pdf(?:$|\?)/i.test(href)) return resolve(href, baseUrl)
  }
  return null
}

/** 「市道師戸・江川線の一部区間」や「道路冠水により、市道師戸・江川線の一部区間を通行止めに…」から路線と場所 */
export function inzaiRoadOf(text: string) {
  const s = text.normalize('NFKC').replace(/\s+/g, '')
  const m = s.match(/((?:市道|県道|国道)[^、。を]*?(?:線|号))(?:の)?([^、。を]*?)(?:を|$|の通行止|における)/)
  if (m) return { road: m[1], place: m[2].replace(/(?:道路)?冠水による通行止め.*$/, '') }
  const near = s.match(/^([^、。]*?付近)/)
  return { road: '', place: near ? near[1] : '' }
}

/**
 * 「主要幹線道路等の通行止めの状況」（0000022584 など）のように、1ページに路線を並べた一覧。
 * 本文の「【令和8年9月26日 8：00現在】」から「通行止め状況位置図」までの各行を
 * 「県道千葉竜ケ崎線　八千代市との行政界付近　⇒　通行止め解除」の形で読む（2026-09-26 事業主指摘：
 * このページを記事1件と読み違え、県道千葉竜ケ崎線の通行止めと中平橋付近の解除を取りこぼしていた）。
 * 一覧が無いページは null。
 */
export function parseInzaiTrunkList(html: string) {
  const root = parseHtml(html)
  const body = root.querySelector('.mol_contents')
  if (!body) return null
  const text = body.innerHTML
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .normalize('NFKC')
  const head = text.match(/【\s*令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日\s*(\d+)\s*[:：]\s*(\d+)\s*現在\s*】/)
  if (!head) return null
  const [y, mo, d, h, mi] = head.slice(1).map(Number)
  const asOf = new Date(Date.UTC(2018 + y, mo - 1, d, h - 9, mi)).toISOString()
  const after = text.slice((head.index ?? 0) + head[0].length)
  const end = after.search(/通行止め状況位置図|PDFファイルの閲覧/)
  const lines = (end >= 0 ? after.slice(0, end) : after).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const items: Array<{ road: string; place: string; cleared: boolean; note: string }> = []
  for (const line of lines) {
    const m = line.match(/^((?:県道|国道|市道|町道)\s*[^\s⇒]*?(?:線|号))\s*(.*)$/)
    if (!m) continue
    const [placePart, ...rest] = m[2].split('⇒')
    const outcome = rest.join('⇒').trim()
    items.push({
      road: m[1].replace(/\s+/g, ''),
      place: placePart.trim(),
      cleared: /解除/.test(outcome),
      note: outcome,
    })
  }
  return items.length ? { asOf, items } : null
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
  // まとめページ自身は記事ではないので候補にしない（題名に「通行止め」があり、路線名が空の行になっていた）
  for (const item of news) if (/通行止/.test(item.title) && !/解除/.test(item.title) && !statusUrls.has(item.url)) candidates.set(item.url, item.title)
  for (const [url, info] of statusOf) if (!candidates.has(url)) candidates.set(url, info.title)
  for (const row of activeRows) if (row.url && !candidates.has(row.url)) candidates.set(row.url, '')

  const active: ClosureDraft[] = []
  const cleared: Record<string, ClearReason> = {}
  const trunkLists: Array<{ url: string; asOf: string; items: Array<{ road: string; place: string; cleared: boolean; note: string }>; mapUrl: string | null }> = []
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
    // 路線を並べた一覧のページは、記事1件ではなく一覧として読む（後でまとめて反映）
    const trunk = parseInzaiTrunkList(page.text)
    if (trunk) {
      trunkLists.push({ url, ...trunk, mapUrl: parseInzaiMapPdf(page.text, url) })
      // 以前このページを記事1件と読んでいた行（路線名が空）は外す
      if (prev && !prev.cleared_at) cleared[url] = 'disappeared'
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
      raw: { statusUrl: statusUrl ?? null, onStatus: Boolean(onStatus || prevRaw.onStatus), mapUrl: parseInzaiMapPdf(page.text, url) },
    })
  }

  // 一覧のページの各行を反映する。記事で出している路線は二重に出さない。
  // 一覧で「⇒ 通行止め解除」とされた路線は、同じ路線の記事の行も解除する（一覧のほうが新しいため）
  for (const list of trunkLists) {
    notes.push(`路線の一覧 ${list.items.length}行（${list.asOf} 現在）を確認: ${list.url}`)
    for (const item of list.items) {
      const key = `${list.url}#${item.road}#${item.place}`
      const sameRoad = active.filter((a) => a.key !== key && a.road === item.road)
      if (item.cleared) {
        for (const a of sameRoad) {
          cleared[a.key] = 'announced'
          active.splice(active.indexOf(a), 1)
        }
        if (known.has(key)) cleared[key] = 'announced'
        continue
      }
      if (sameRoad.length) continue
      active.push({
        key,
        road: item.road,
        place: item.place,
        reason: '道路冠水',
        municipality: '印西市',
        inArea: true,
        url: list.url,
        sourceTitle: '主要幹線道路等の通行止めの状況',
        publishedAt: list.asOf,
        raw: { trunkList: true, asOf: list.asOf, note: item.note, mapUrl: list.mapUrl },
      })
    }
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
// 千葉県 印旛土木事務所（https://www.pref.chiba.lg.jp/cs-inba/shinchaku.html）
// ---------------------------------------------------------------------------
// 管内は印西・白井・佐倉・四街道・八街・酒々井・栄町。県の一覧（pl_6302 など）とは別に、自所の新着へ
// 「通行規制情報（…）」の記事を載せる（2026-09-22 事業主指示で情報源に追加）。記事の中に規制が
// 「規制内容／規制区間／規制期間」の箇条書きで並ぶので、1規制＝1件として扱う。
// 解除：記事の題名に「解除」／記事が消えた（404）／記事から規制が消えた（記事は読めている）／規制期間が過ぎた。
// 期間が始まっていない規制（「令和8年11月1日（予定）から」など）は始まるまで出さない。
// 新着は5件ほどしか載らないので、新着から落ちただけでは解除しない（前回までの記事は読み直す）。

const INBA_NEWS = 'https://www.pref.chiba.lg.jp/cs-inba/shinchaku.html'
const INBA_DETAIL_LIMIT = 8

export type InbaEntry = { heading: string; content: string; section: string; period: string; road: string; place: string; municipality: string }

/** 「令和8年1月7日から令和8年11月31日」→ 開始・終了（JST の日付。実在しない日は月末に丸める） */
export function parsePeriod(text: string): { start: string | null; end: string | null } {
  const s = text.normalize('NFKC')
  const dates = [...s.matchAll(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)].map((m) => {
    const year = 2018 + (m[1] === '元' ? 1 : Number(m[1]))
    const month = Number(m[2])
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const day = Math.min(Number(m[3]), last)
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
  const hasFrom = /から|～|〜/.test(s)
  return {
    start: dates[0] ? `${dates[0]}T00:00:00+09:00` : null,
    end: dates[1] ? `${dates[1]}T23:59:59+09:00` : (!hasFrom && dates[0] ? `${dates[0]}T23:59:59+09:00` : null),
  }
}

/** 記事本文から規制を取り出す。本文の枠が無ければ null（読めない＝何も解除しない） */
export function parseInbaDetail(html: string): { title: string; entries: InbaEntry[] } | null {
  const root = parseHtml(html)
  const body = root.querySelector('#tmp_contents') ?? root.querySelector('#tmp_main')
  if (!body) return null
  const title = clean(body.querySelector('h1')?.innerHTML ?? '').replace(/[│|｜]\s*印旛土木事務所\s*$/, '')
  const entries: InbaEntry[] = []
  let heading = ''
  for (const node of body.querySelectorAll('h2, h3, h4, ul')) {
    if (node.tagName !== 'UL') { heading = clean(node.innerHTML); continue }
    const fields: Record<string, string> = {}
    for (const li of node.querySelectorAll('li')) {
      const text = clean(li.innerHTML.replace(/<br\s*\/?>/gi, ' '))
      const m = text.match(/^(規制内容|規制区間|規制期間)\s*[:：]\s*(.*)$/)
      if (m) fields[m[1]] = m[2].trim()
    }
    if (!fields['規制区間']) continue
    const section = fields['規制区間'].normalize('NFKC').replace(/\s+/g, ' ').trim()
    const road = (section.match(/((?:一般|主要地方道)?\s*(?:県道|国道)[^\s]*?(?:線|号))/)?.[1] ?? '').replace(/^一般\s*/, '').replace(/\s+/g, '')
    const place = section.replace(/^.*?(?:線|号)\s*/, '').trim()
    entries.push({
      heading,
      content: fields['規制内容'] ?? '',
      section,
      period: fields['規制期間'] ?? '',
      road,
      place,
      municipality: place.match(/^(.+?[市町村])/)?.[1] ?? '',
    })
  }
  return { title, entries }
}

export function parseInbaNews(html: string, baseUrl = INBA_NEWS) {
  const root = parseHtml(html)
  const rows = root.querySelectorAll('table.list_table tr')
  return rows.map((tr) => {
    const a = tr.querySelector('a')
    const url = a ? resolve(a.getAttribute('href') ?? '', baseUrl) : null
    return { title: clean(a?.innerHTML ?? ''), url, date: parseJpDate(tr.querySelector('.date')?.text ?? '') }
  }).filter((row): row is { title: string; url: string; date: string | null } => Boolean(row.url && row.title))
}

export async function scanInba(source: ClosureSource, existing: ExistingClosure[], now = new Date()): Promise<ClosureScan> {
  const newsUrl = source.url || INBA_NEWS
  const newsPage = await fetchPage(newsUrl)
  if (!newsPage.ok) throw new Error(`HTTP ${newsPage.status}: ${newsUrl}`)
  const news = parseInbaNews(newsPage.text, newsUrl)
  if (!news.length) throw new Error('印旛土木事務所の新着が読めません（ページの形が変わった可能性）')
  const areas = configList(source, 'areas', DEFAULT_AREAS)

  // 読む記事：新着の通行規制・通行止めの記事＋config の指定＋前回まで通行止め中だった記事
  const pages = new Set<string>(configList(source, 'pageUrls', ''))
  for (const item of news) if (/通行規制|通行止/.test(item.title)) pages.add(item.url)
  const activeRows = existing.filter((row) => !row.cleared_at)
  for (const row of activeRows) {
    const pageUrl = (row.raw as { pageUrl?: string } | null)?.pageUrl
    if (pageUrl) pages.add(pageUrl)
  }

  const notes = [`新着 ${news.length}件・記事 ${pages.size}件を確認`]
  const active: ClosureDraft[] = []
  const cleared: Record<string, ClearReason> = {}
  const rowsOfPage = (pageUrl: string) => activeRows.filter((row) => (row.raw as { pageUrl?: string } | null)?.pageUrl === pageUrl)
  let fetched = 0
  for (const pageUrl of pages) {
    const keep = () => { for (const row of rowsOfPage(pageUrl)) active.push({ ...keepAsIs(row, row.url ?? pageUrl), municipality: String((row.raw as Record<string, unknown> | null)?.municipality ?? '') }) }
    if (fetched >= INBA_DETAIL_LIMIT) { keep(); continue }
    fetched += 1
    const page = await fetchPage(pageUrl)
    if (!page.ok) {
      if (page.status === 404 || page.status === 410) { for (const row of rowsOfPage(pageUrl)) cleared[row.closure_key] = 'disappeared'; continue }
      keep(); notes.push(`記事を読めませんでした（${page.status}）: ${pageUrl}`); continue
    }
    const detail = parseInbaDetail(page.text)
    if (!detail) { keep(); notes.push(`記事の形が読めませんでした: ${pageUrl}`); continue }
    if (/解除/.test(detail.title)) { for (const row of rowsOfPage(pageUrl)) cleared[row.closure_key] = 'announced'; continue }
    for (const entry of detail.entries) {
      if (!/通行止/.test(`${entry.content} ${entry.heading}`)) continue
      const key = `${pageUrl}#${normalizeKey(entry.section)}`
      const { start, end } = parsePeriod(entry.period)
      if (end && Date.parse(end) < now.getTime()) { cleared[key] = 'announced'; continue }   // 期間が過ぎた
      if (start && Date.parse(start) > now.getTime()) continue                               // まだ始まっていない
      active.push({
        key,
        road: entry.road,
        place: entry.place,
        reason: reasonOf(`${entry.heading} ${entry.content}`) || '工事',
        municipality: entry.municipality,
        inArea: entry.municipality ? areas.some((a) => entry.municipality.includes(a)) : true,
        url: pageUrl,
        sourceTitle: detail.title,
        publishedAt: start,
        raw: { pageUrl, periodStart: start, periodEnd: end, periodText: entry.period.slice(0, 80), municipality: entry.municipality },
      })
    }
  }
  return { active, cleared, notes }
}

// ---------------------------------------------------------------------------
// 市が Google マイマップで公開する通行止め地図（佐倉市「佐倉市内通行止め箇所」など）
// ---------------------------------------------------------------------------
// 市の号外ページ（例 https://www.city.sakura.lg.jp/soshiki/kikikanrika/taihuu25/22665.html）に
// マイマップが埋め込まれ、KML（/maps/d/kml?mid=…&forcekml=1）で区間の線と説明が取れる（2026-09-22 事業主指示で追加）。
// 1 Placemark＝1件（鍵＝名前＋線の始まりの位置）。解除は「前回あって今回の KML に無い」。
// 号外は災害のたびに新しいページになりうるので、config の号外ページ（pages）と一覧ページ（indexPages）に出る
// 「通行止め」の号外を読み、埋め込まれた mid を拾う。どこからも拾えなければ前回の mid の KML を読む。
// 市が描いた線は raw.cityPath に保存するが、地図に出すかは事業主の確認待ち（path には入れない）。

export type MyMapPlacemark = { name: string; description: string; coords: Array<[number, number]> }

/** 2点のおおよその距離（m） */
export function distanceM(a: [number, number], b: [number, number]) {
  const dLat = (a[0] - b[0]) * 111320
  const dLon = (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

const SAME_LINE_M = 300          // 同じ名前なら、始点がこれだけ離れていても同じ線とみなす
const REVIVE_WITHIN_MS = 86400000 // 解除から24時間以内に戻った線は、同じ行を使い続ける（継続時間を切らない）

/** 鍵から始点（緯度,経度）を読む。古い行のために raw.cityPath も見る */
export function keyPoint(row: ExistingClosure): [number, number] | null {
  const m = row.closure_key.match(/\|(-?\d+\.\d+),(-?\d+\.\d+)$/)
  if (m) return [Number(m[1]), Number(m[2])]
  const path = (row.raw as { cityPath?: Array<[number, number]> } | null)?.cityPath
  return Array.isArray(path) && path.length ? path[0] : null
}

/**
 * 役所が線を引き直して始点が少し動いても、同じ線として扱うための突き合わせ。
 * 名前が同じで始点が300m以内の行があればその鍵を使う（通行止め中の行を優先、無ければ24時間以内に解除された行）。
 */
export function matchExistingLine(existing: ExistingClosure[], name: string, point: [number, number], now: number) {
  const named = existing.filter((row) => row.closure_key.includes(`|${normalizeKey(name)}|`))
  const usable = named.filter((row) => {
    if (!row.cleared_at) return true
    const at = Date.parse(row.cleared_at)
    return Number.isFinite(at) && now - at <= REVIVE_WITHIN_MS
  })
  let best: { row: ExistingClosure; d: number } | null = null
  for (const row of usable) {
    const p = keyPoint(row)
    if (!p) continue
    const d = distanceM(p, point)
    if (d <= SAME_LINE_M && (!best || d < best.d || (d === best.d && !row.cleared_at))) best = { row, d }
  }
  return best?.row.closure_key ?? null
}

export function parseKml(kml: string): MyMapPlacemark[] {
  const out: MyMapPlacemark[] = []
  for (const m of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const body = m[1]
    const name = clean(body.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '') ?? '')
    const description = clean((body.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<br\s*\/?>/gi, ' '))
    const coordText = body.match(/<coordinates>([\s\S]*?)<\/coordinates>/)?.[1] ?? ''
    const coords = coordText.trim().split(/\s+/).map((c) => c.split(',').map(Number)).filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map((c) => [Math.round(c[1] * 1e6) / 1e6, Math.round(c[0] * 1e6) / 1e6] as [number, number])
    if (name && coords.length) out.push({ name, description, coords })
  }
  return out
}

export function myMapMids(html: string) {
  return [...new Set([...html.matchAll(/maps\/d\/(?:u\/\d+\/)?(?:embed|viewer|edit|kml)\?(?:[^"'\s]*?&(?:amp;)?)?mid=([A-Za-z0-9_-]{20,})/g)].map((m) => m[1]))]
}

/** 「通行止め（石川）」「道路崩壊地点（飯田 佐倉カントリー倶楽部付近）」→ 括弧の中を場所に */
export function myMapPlace(name: string, description: string) {
  const inParen = name.normalize('NFKC').match(/[（(]([^）)]+)[）)]/)?.[1]?.trim() ?? ''
  const where = description.normalize('NFKC').match(/^(.{2,40}?(?:付近|地先|周辺))/)?.[1]?.trim() ?? ''
  return where || inParen || name
}

export async function scanMyMap(source: ClosureSource, existing: ExistingClosure[]): Promise<ClosureScan> {
  const municipality = configString(source, 'municipality', '')
  const areas = configList(source, 'areas', DEFAULT_AREAS)
  const pages = new Set(configList(source, 'pages', source.url))
  const notes: string[] = []
  // 一覧ページから「通行止め」の号外を拾う（新しい号外に地図が載り替わったときのため）
  for (const idx of configList(source, 'indexPages', '')) {
    const page = await fetchPage(idx)
    if (!page.ok) { notes.push(`一覧ページを読めませんでした（${page.status}）: ${idx}`); continue }
    for (const m of page.text.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (/通行止/.test(clean(m[2]))) { const u = resolve(m[1], idx); if (u) pages.add(u) }
    }
  }
  // 号外ページに埋め込まれた地図（mid）。新しい号外ほど後ろ（ページ番号が大きい）とみなし、最後のものを使う
  let mid = ''
  let pageUrl = ''
  const sorted = [...pages].sort((a, b) => (Number(a.match(/(\d+)\.html$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.html$/)?.[1] ?? 0)))
  for (const url of sorted) {
    const page = await fetchPage(url)
    if (!page.ok) { notes.push(`号外ページを読めませんでした（${page.status}）: ${url}`); continue }
    const found = myMapMids(page.text)
    if (found.length) { mid = found[found.length - 1]; pageUrl = url }
  }
  if (!mid) {
    const prev = existing.map((row) => row.raw as { mid?: string; pageUrl?: string } | null).find((raw) => raw?.mid)
    mid = configString(source, 'mid', prev?.mid ?? '')
    pageUrl = prev?.pageUrl ?? source.url
    if (!mid) throw new Error('マイマップの mid が見つかりません（号外ページの形が変わった可能性）')
    notes.push('号外ページから地図が見つからないため、前回の地図を読みました')
  }
  const kmlUrl = `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`
  const kml = await fetchRequired(kmlUrl)
  if (!/<kml[\s>]/.test(kml)) throw new Error('KML ではない応答でした（地図の公開設定が変わった可能性）')
  const placemarks = parseKml(kml)
  notes.unshift(`地図 ${mid.slice(0, 8)}… の ${placemarks.length}件を確認`)

  const nowMs = Date.now()
  const taken = new Set<string>()
  const active: ClosureDraft[] = placemarks.map((pm) => {
    const [lat, lon] = pm.coords[0]
    // 役所が線を引き直すと始点が数十m動く。同じ名前で近ければ前と同じ行を使う（継続時間の起点を保つ）
    const matched = matchExistingLine(existing.filter((row) => !taken.has(row.closure_key)), pm.name, [lat, lon], nowMs)
    if (matched) taken.add(matched)
    const key = matched ?? `${mid}|${normalizeKey(pm.name)}|${lat.toFixed(4)},${lon.toFixed(4)}`
    const place = myMapPlace(pm.name, pm.description)
    const isLine = pm.coords.length >= 2
    return {
      key,
      road: '',
      place: municipality && !place.startsWith(municipality) ? `${municipality} ${place}` : place,
      reason: reasonOf(`${pm.name} ${pm.description}`),
      municipality,
      inArea: municipality ? areas.some((a) => municipality.includes(a)) : true,
      url: pageUrl || source.url,
      sourceTitle: pm.name,
      publishedAt: parseJpDate(pm.description),
      raw: { mid, pageUrl, kind: isLine ? 'line' : 'point', cityPath: pm.coords.slice(0, 200) },
    }
  })
  // 同じ名前・同じ始点の Placemark が重なっていたら1件にまとめる（鍵が重なると保存で失敗するため）
  const unique = [...new Map(active.map((item) => [item.key, item])).values()]
  return { active: unique, cleared: {}, notes }
}

// ---------------------------------------------------------------------------
// 自治体のメール配信のバックナンバー（栄町「さかえ情報メール」 https://plus.sugumail.com/usr/sakae/doc など）
// ---------------------------------------------------------------------------
// 1配信＝article.panel（日時 .small・題名 h3・本文 p・個別ページ data-href）。新しい順に並ぶ（2026-09-22 事業主指示で追加）。
// 題名に「通行止」があり「解除」が無ければ通行止め、同じ道路名で「解除」の配信が後から出たら解除（announced）。
// バックナンバーから押し出されただけでは解除しない。解除の配信が無いまま maxAgeDays（既定14日）たったら外す。

export type MailNotice = { date: string | null; title: string; body: string; url: string | null }

export function parseSugumail(html: string, baseUrl: string): MailNotice[] {
  const root = parseHtml(html)
  return root.querySelectorAll('article.panel').map((a) => {
    const href = a.getAttribute('data-href') ?? a.querySelector('a')?.getAttribute('href') ?? ''
    const dateText = (a.querySelector('.small')?.text ?? '').normalize('NFKC')
    const m = dateText.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
    const date = m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${(m[4] ?? '0').padStart(2, '0')}:${m[5] ?? '00'}:00+09:00` : null
    return {
      date,
      title: clean(a.querySelector('h3')?.innerHTML ?? ''),
      body: clean((a.querySelector('p')?.innerHTML ?? '').replace(/<br\s*\/?>/gi, ' ')),
      url: href ? resolve(href, baseUrl) : null,
    }
  }).filter((n) => n.title)
}

/** 「県道鎌ヶ谷本埜線バイパス（全線）の車両通行止めのお知らせ」→ 道路名と区間 */
export function mailRoadOf(title: string) {
  const s = title.normalize('NFKC')
  const road = s.match(/((?:主要地方道|一般県道|県道|国道|町道|市道)[^\s（(のをに、]*?(?:線|号)(?:バイパス|BP)?)/)?.[1] ?? ''
  const section = road ? (s.slice(s.indexOf(road) + road.length).match(/^[（(]([^）)]+)[）)]/)?.[1] ?? '') : ''
  return { road: road.replace(/^一般/, ''), section, key: normalizeKey(road.replace(/^(主要地方道|一般県道)/, '県道')) }
}

export async function scanSugumail(source: ClosureSource, existing: ExistingClosure[], now = new Date()): Promise<ClosureScan> {
  const url = source.url
  if (!url) throw new Error('URL（バックナンバーのページ）が必要です')
  const notices = parseSugumail(await fetchRequired(url), url)
  if (!notices.length) throw new Error('配信のバックナンバーが読めません（ページの形が変わった可能性）')
  const municipality = configString(source, 'municipality', '')
  const areas = configList(source, 'areas', DEFAULT_AREAS)
  const maxAgeMs = Math.max(Number(configString(source, 'maxAgeDays', '14')) || 14, 1) * 86400000

  const state = new Map<string, ClosureDraft>()
  const cleared: Record<string, ClearReason> = {}
  for (const n of [...notices].reverse()) {          // 古い順にたどる
    if (!/通行止/.test(n.title)) continue
    const info = mailRoadOf(n.title)
    if (!info.road) continue
    if (/解除/.test(n.title)) { state.delete(info.key); cleared[info.key] = 'announced'; continue }
    delete cleared[info.key]
    state.set(info.key, {
      key: info.key,
      road: info.road,
      place: info.section,
      reason: reasonOf(`${n.title} ${n.body}`),
      municipality,
      inArea: municipality ? areas.some((a) => municipality.includes(a)) : true,
      url: n.url ?? url,
      sourceTitle: n.title,
      publishedAt: n.date,
      raw: { noticeUrl: n.url },
    })
  }
  const active = [...state.values()]
  // 押し出された通行止めは前回のまま残す。ただし発表から maxAgeDays を過ぎたら外す
  for (const row of existing) {
    if (row.cleared_at || state.has(row.closure_key) || cleared[row.closure_key]) continue
    const raw = (row.raw ?? {}) as Record<string, unknown>
    const published = Date.parse(String(raw.publishedAt ?? ''))
    if (Number.isFinite(published) && now.getTime() - published > maxAgeMs) continue
    active.push({ ...keepAsIs(row, row.url ?? url), municipality })
  }
  for (const item of active) if (item.raw && !item.raw.keptAsIs) item.raw.publishedAt = item.publishedAt
  return { active, cleared, notes: [`配信 ${notices.length}件を確認`] }
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
  if (source.kind === 'road-closure-inba') return scanInba(source, existing)
  if (source.kind === 'road-closure-mymap') return scanMyMap(source, existing)
  if (source.kind === 'road-closure-sugumail') return scanSugumail(source, existing)
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
    // 運営がこの通行止めを市民記録（通れない道）として代理登録していたら、解除と同時に地図から伏せる。
    // raw.linkedPassedRoadIds に id を入れておく（2026-09-22 栄町の県道鎌ヶ谷本埜線バイパスで導入）
    const linked = ((row.raw ?? {}) as { linkedPassedRoadIds?: unknown }).linkedPassedRoadIds
    if (Array.isArray(linked) && linked.length) {
      const ids = linked.filter((v): v is string => typeof v === 'string')
      if (ids.length) await supabase.from('disaster_passed_roads').update({ hidden: true }).in('id', ids)
    }
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
