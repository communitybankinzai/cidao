// 警戒レベルが上がったときに、市民へ速やかに知らせるための自動SNS投稿。
//
// なぜ作るか：2026-09-06 の大雨では、気象庁が警報を出してから当団体が投稿するまで
// 毎回20〜40分かかっていた。深夜に人が起きていないと届かない、という状態だった。
//
// 安全のための決めごと（勝手に変えないこと）:
//   1. 本文に創作を混ぜない。公式が出した文章をそのまま引用し、当団体の解釈は書かない。
//   2. 「公式発表ではない」「判断は市の公式情報に従う」を必ず末尾に付ける。
//   3. レベルが「上がったとき」だけ出す。同じ状態が続いている間は黙る。
//   4. 同じ内容は二度出さない（内容のハッシュで判定）。
//   5. 自動で出すのは既定でレベル4以上。それ未満は承認待ちにして人が判断する。
//   6. 解除は自動で出す（「まだ危ない」と誤解させたままにしない）。
//
// 設定は app_settings の `disaster_auto_post`、状態は `disaster_auto_post_state`。
// 管理画面から止められるように、enabled が true のときだけ動く。

import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSnsCredentials, postToMedium } from '@/lib/sns-dispatch'
import type { SnsMedium } from '@/lib/sns-template'

const MAP_URL = 'https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/'
const JMA_URL = 'https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=1223100'
const CITY_URL = 'https://www.city.inzai.lg.jp/bousaiportal/'
const APPROVE_BASE = 'https://cidao.vercel.app/disaster/approve'

export type AutoPostConfig = {
  enabled: boolean
  autoLevel: number       // これ以上は人の承認なしで投稿する
  approvalLevel: number   // これ以上は承認待ちを作る
  media: SnsMedium[]
  minIntervalMinutes: number
  notifyTo?: string       // 承認リンクの通知先メール
}

export type AutoPostState = {
  level: number
  hash: string
  updatedAt: string
  lastPostedAt?: string
  history?: Array<{ at: string; level: number; kind: string; result?: unknown }>
}

export type TimelineItemLite = {
  title: string
  body: string | null
  source_id?: string | null
  occurred_at: string
  change_type?: string | null
  /** 呼び出し側が disaster_info_sources から引いて詰める */
  kind?: string
  sourceLabel?: string
}

const DEFAULT_CONFIG: AutoPostConfig = {
  enabled: false,
  autoLevel: 4,
  approvalLevel: 3,
  media: ['threads'],
  minIntervalMinutes: 30,
}

// 文言から警戒レベルを読む。気象庁の警報名には既に「レベル4」等が入っている
// （disaster-timeline.ts の JMA_WARNING_NAMES）ので、まずそれを使う。
// 市の避難情報と、気象庁XMLの一部は名前からレベルが分からないので個別に対応する。
const LEVEL_RULES: Array<{ re: RegExp; level: number }> = [
  { re: /緊急安全確保/, level: 5 },
  { re: /氾濫発生情報/, level: 5 },
  { re: /大雨特別警報|土砂災害特別警報|高潮特別警報/, level: 5 },
  { re: /避難指示/, level: 4 },
  { re: /氾濫危険情報/, level: 4 },
  { re: /土砂災害警戒情報/, level: 4 },
  { re: /記録的短時間大雨情報/, level: 4 },
  { re: /高齢者等避難/, level: 3 },
  { re: /氾濫警戒情報/, level: 3 },
  { re: /避難所.{0,6}(開設|開放)/, level: 3 },
]

const CANCEL_RE = /解除|発表中の警報・注意報なし|発表なし|避難所.{0,6}(閉鎖|閉所)/

// ⚠ ここが最も重要な安全装置。2026-09-07 のテストで、
//   「千葉県 緊急情報【レベル５大雨特別警報 が発表されたときにとるべき行動】」を
//   レベル5と誤判定した。これは特別警報が出たという報ではなく啓発文で、
//   そのまま自動投稿していたら「印西市にレベル5」と嘘を発信していた。
//   同様に「気象庁 土砂災害警戒情報」は千葉県全体への情報で、
//   印西市に出ているとは限らない（9/6の印西市は注意報どまりだった）。
//
// 対策：レベルの根拠にしてよいのは「印西市に出ていることが確実な情報源」だけに限る。
//   県単位・全国単位の情報は、参考として地図には出すがレベル判定には使わない。
//
// ⚠ ラベル（表示名）ではなく kind（パーサの種類）で判定する。
//   ラベルは管理画面から自由に変えられるので、ラベルで判定すると
//   名前を変えただけで安全装置が外れる。実際、初版は「印西市 災害情報」で
//   照合していたが、本番のラベルは「印西市 防災情報（市公式）」で一致しなかった。
//
// useBody: 本文までレベルの根拠にしてよいか。
//   気象庁の警報はタイトルに「レベル2大雨注意報」と入るので本文は不要で、
//   むしろ本文の解説文（「南部では…」等）を拾うと誤判定になる。
//   一方、防災行政無線はタイトルが「防災行政無線の内容」で固定なので、
//   本文（「避難所を開設します」等）を見ないと判定できない。
const CITY_KINDS: Record<string, { useBody: boolean }> = {
  'jma-warning': { useBody: false },      // 気象庁 印西市の警報・注意報（areaCode 1223100 で絞り込み済み）
  'city-alert-xml': { useBody: true },    // 印西市 防災行政無線
  'city-category-html': { useBody: true },// 印西市の公式ページ（防災情報・避難情報・避難所）
  'chiba-hinan-list': { useBody: true },  // 千葉県の避難情報（パーサが印西市の行だけを抜いている）
  'city-mail': { useBody: true },         // 印西市 防災メール（市が配信するもの。件名だけでは分からないので本文も見る）
}
// 使わない kind（参考のため明記）:
//   jma-overview（県の概況）／jma-quake（地震）／sns-priority（市長SNS・準公式）／
//   chiba-bousai-portal（県全体）／jma-xml-feed（県単位）／x-timeline（県防災X）

// 「〜が発表されたときにとるべき行動」のような、実際には起きていない仮定の文
const HYPOTHETICAL_RE = /とるべき行動|発表されたとき|発令されたとき|場合には|ときは|とは何か|について$|備え/

export function cityKindOf(kind: string) {
  return CITY_KINDS[kind] ?? null
}

export function levelOf(text: string): number {
  const explicit = /レベル([1-5])/.exec(text)
  const fromName = explicit ? Number(explicit[1]) : 0
  let level = fromName
  for (const rule of LEVEL_RULES) {
    if (rule.re.test(text)) level = Math.max(level, rule.level)
  }
  return level
}

export type Signal = {
  level: number
  title: string
  body: string
  source: string
  occurredAt: string
}

/** 直近の項目から、いま出ている最も高いレベルの信号を拾う。 */
export function extractSignals(items: TimelineItemLite[], withinMinutes = 180): Signal[] {
  const limit = Date.now() - withinMinutes * 60 * 1000
  const out: Signal[] = []
  for (const item of items) {
    const at = Date.parse(item.occurred_at)
    if (!Number.isFinite(at) || at < limit) continue
    const title = String(item.title ?? '')
    const body = String(item.body ?? '')
    const source = String(item.sourceLabel ?? '')
    if (CANCEL_RE.test(title)) continue          // 解除の報はレベルの根拠にしない
    const city = cityKindOf(String(item.kind ?? ''))
    if (!city) continue                          // 県・全国の情報は根拠にしない（上の注記を参照）
    const judged = city.useBody ? `${title}\n${body}` : title
    if (HYPOTHETICAL_RE.test(judged)) continue   // 「〜が発表されたときにとるべき行動」等の啓発文
    if (CANCEL_RE.test(judged)) continue
    const level = levelOf(judged)
    if (level >= 3) {
      out.push({ level, title, body, source, occurredAt: item.occurred_at })
    }
  }
  return out.sort((a, b) => b.level - a.level || b.occurredAt.localeCompare(a.occurredAt))
}

function jstLabel(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const jst = new Date(d.getTime() + 9 * 3600 * 1000)
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日${jst.getUTCHours()}時${String(jst.getUTCMinutes()).padStart(2, '0')}分`
}

const FOOTER = [
  '',
  '最新の状況は必ず公式発信でご確認ください。',
  `・印西市 防災ポータル ${CITY_URL}`,
  '・印西市公式LINE／防災行政無線',
  `・気象庁 ${JMA_URL}`,
  '',
  '▼危険度・雨量・避難所を1つの地図で（CBIの試作MAP・参考）',
  MAP_URL,
  '',
  '※市民団体による自動発信で、公式発表ではありません。避難の判断は必ず市の公式情報に従ってください。緊急時は119・110へ。',
  '#印西市 #防災',
].join('\n')

// 防災行政無線は毎回この決まり文句で始まり・終わるので、見出しには使わない
const BROADCAST_BOILERPLATE = /^こちらは、?\s*防災いんざいです。?$/
// タイトルが中身を表していない情報源。この場合は本文から見出しを作る
const GENERIC_TITLE = /^(防災行政無線の内容|お知らせ|新着情報)$/

/** 見出しに使う一文を選ぶ。決まり文句と空行を落として、最初の意味のある行を取る。 */
export function headlineOf(signal: Signal): string {
  const title = signal.title.replace(/^印西市：/, '').trim()
  if (title && !GENERIC_TITLE.test(title)) return title
  const line = signal.body
    .split(/\n+/)
    .map((x) => x.trim())
    .find((x) => x && !BROADCAST_BOILERPLATE.test(x))
  return (line ?? title ?? '').slice(0, 60)
}

/** 引用する本文。決まり文句を落として読みやすくする。 */
function quoteOf(signal: Signal): string {
  return signal.body
    .split(/\n+/)
    .map((x) => x.trim())
    .filter((x) => x && !BROADCAST_BOILERPLATE.test(x))
    .join('\n')
    .slice(0, 300)
}

/** 投稿本文を作る。公式の文章をそのまま引用し、当団体の解釈は加えない。 */
export function buildText(signals: Signal[], level: number): string {
  const top = signals.filter((s) => s.level === level)
  const heads = [...new Set(top.map(headlineOf).filter(Boolean))]
  const when = top[0] ? jstLabel(top[0].occurredAt) : ''
  const lines = [
    `【印西市：${heads[0] ?? `警戒レベル${level}相当の情報`}】`,
    '',
    `${when ? when + '、' : ''}印西市に警戒レベル${level}相当の情報が出ています。`,
  ]
  if (heads.length > 1) lines.push(`ほかに：${heads.slice(1, 3).join('／')}`)
  lines.push('')
  for (const s of top.slice(0, 2)) {
    const quoted = quoteOf(s)
    if (quoted) {
      lines.push(`■ ${s.source || '公式発表'}より`)
      lines.push(quoted)
      lines.push('')
    }
  }
  if (level >= 4) {
    lines.push('■ 警戒レベル4相当は「危険な場所から全員避難」の段階です。')
    lines.push('土砂災害警戒区域や低い土地にお住まいの方は、市の避難情報を確認してください。')
  } else if (level === 3) {
    lines.push('■ 警戒レベル3相当は「高齢の方や避難に時間がかかる方は避難」の段階です。')
  }
  return (lines.join('\n') + FOOTER).slice(0, 480)
}

function hashOf(signals: Signal[], level: number) {
  const key = signals
    .filter((s) => s.level === level)
    .map((s) => s.title)
    .sort()
    .join('|')
  return createHash('sha256').update(`${level}:${key}`, 'utf8').digest('hex').slice(0, 32)
}

async function readSetting<T>(supabase: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  const value = data?.value as T | undefined
  return value === undefined || value === null ? fallback : { ...fallback, ...(value as object) } as T
}

async function writeSetting(supabase: SupabaseClient, key: string, value: unknown) {
  await supabase.from('app_settings').upsert({ key, value })
}

export type AutoPostOutcome = {
  ran: boolean
  level: number
  previousLevel: number
  action: 'none' | 'posted' | 'approval' | 'cancelled' | 'skipped'
  reason?: string
  approveUrl?: string
  result?: Record<string, unknown>
}

/**
 * 巡回のあとに呼ぶ。レベルが上がっていれば投稿、または承認待ちを作る。
 * 例外は投げない（巡回そのものを止めないため）。
 */
export async function runAutoPost(supabase: SupabaseClient): Promise<AutoPostOutcome> {
  const config = await readSetting<AutoPostConfig>(supabase, 'disaster_auto_post', DEFAULT_CONFIG)
  if (!config.enabled) return { ran: false, level: 0, previousLevel: 0, action: 'none', reason: 'disabled' }

  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
  // disaster_timeline_items にラベルは無い（source_id で情報源テーブルを引く）
  const [{ data: rows, error }, { data: sources }] = await Promise.all([
    supabase
      .from('disaster_timeline_items')
      .select('title, body, source_id, occurred_at, change_type')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(200),
    supabase.from('disaster_info_sources').select('id, label, kind'),
  ])
  if (error) return { ran: false, level: 0, previousLevel: 0, action: 'none', reason: error.message }
  const byId = new Map(
    (sources ?? []).map((r) => [String(r.id), { kind: String(r.kind), label: String(r.label) }]),
  )
  const items: TimelineItemLite[] = (rows ?? []).map((r) => {
    const src = byId.get(String(r.source_id))
    return { ...r, kind: src?.kind, sourceLabel: src?.label } as TimelineItemLite
  })

  const signals = extractSignals(items)
  const level = signals.length ? signals[0].level : 0
  const state = await readSetting<AutoPostState>(supabase, 'disaster_auto_post_state', {
    level: 0, hash: '', updatedAt: new Date(0).toISOString(),
  })
  const hash = hashOf(signals, level)
  const out: AutoPostOutcome = { ran: true, level, previousLevel: state.level, action: 'none' }

  // 下がった（解除された）とき：レベル4以上から下がった場合だけ知らせる
  if (level < state.level) {
    await writeSetting(supabase, 'disaster_auto_post_state', {
      ...state, level, hash, updatedAt: new Date().toISOString(),
    })
    if (state.level >= config.autoLevel) {
      const text = [
        `【印西市の警戒レベルが下がりました】（${jstLabel(new Date().toISOString())}時点）`,
        '',
        `警戒レベル${state.level}相当の情報は発表されなくなりました。`,
        level > 0 ? `現在は警戒レベル${level}相当の情報が出ています。` : '現在、レベル3相当以上の情報は出ていません。',
        '雨がやんだ後も、地盤が緩んでいる場所や増水した川には近づかないでください。',
      ].join('\n') + FOOTER
      const result = await dispatch(supabase, config.media, text.slice(0, 480))
      out.action = 'cancelled'
      out.result = result
      await appendHistory(supabase, state, level, 'cancelled', result)
    }
    return out
  }

  if (level < config.approvalLevel) return { ...out, action: 'none', reason: 'below threshold' }
  if (level <= state.level && hash === state.hash) return { ...out, action: 'none', reason: 'no change' }

  const last = state.lastPostedAt ? Date.parse(state.lastPostedAt) : 0
  if (Date.now() - last < config.minIntervalMinutes * 60 * 1000) {
    return { ...out, action: 'skipped', reason: 'min interval' }
  }

  const text = buildText(signals, level)
  const now = new Date().toISOString()

  if (level >= config.autoLevel) {
    const result = await dispatch(supabase, config.media, text)
    await writeSetting(supabase, 'disaster_auto_post_state', {
      ...state, level, hash, updatedAt: now, lastPostedAt: now,
    })
    await appendHistory(supabase, state, level, 'posted', result)
    return { ...out, action: 'posted', result }
  }

  // レベル3相当：人が見てから出す
  const token = randomBytes(24).toString('base64url')
  await writeSetting(supabase, `disaster_approval:${token}`, {
    text,
    media: config.media,
    reason: `警戒レベル${level}相当（自動検出）`,
    createdAt: now,
    expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    status: 'pending',
  })
  await writeSetting(supabase, 'disaster_auto_post_state', {
    ...state, level, hash, updatedAt: now,
  })
  const approveUrl = `${APPROVE_BASE}?token=${token}`
  await appendHistory(supabase, state, level, 'approval', { approveUrl })
  return { ...out, action: 'approval', approveUrl }
}

async function dispatch(supabase: SupabaseClient, media: SnsMedium[], text: string) {
  const creds = await loadSnsCredentials(supabase)
  const result: Record<string, unknown> = {}
  for (const medium of media) {
    try {
      result[medium] = await postToMedium(medium, text, creds, {})
    } catch (e) {
      result[medium] = { status: 'failed', message: e instanceof Error ? e.message : String(e) }
    }
  }
  return result
}

async function appendHistory(
  supabase: SupabaseClient,
  state: AutoPostState,
  level: number,
  kind: string,
  result?: unknown,
) {
  const history = [{ at: new Date().toISOString(), level, kind, result }, ...(state.history ?? [])].slice(0, 50)
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', 'disaster_auto_post_state').maybeSingle()
  const current = (data?.value as AutoPostState | undefined) ?? state
  await writeSetting(supabase, 'disaster_auto_post_state', { ...current, history })
}
