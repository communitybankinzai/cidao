// 食レポの SNS 巡回（2026-11-13 事業主決定 A案）。目的は「地域の飲食店の応援」。
//
// 毎朝の Instagram の2つの取得（#印西 のハッシュタグ検索・監視アカウント）が、すでにメモリに持っている投稿の本文を
// その場で読み、AI が「食レポか・どのお店を紹介しているか・論調」を答え、食レポマップのお店と照合して「候補」にためる。
// 運営が管理画面（/admin/gourmet）で承認したお店だけが地図に出る。自動で公開するものは無い。
//   - Meta への呼び出しは増やさない（取得済みの本文だけを使う）。写真は読まない（写真の承諾が無いため）
//   - 保存するのは 投稿の URL・媒体・投稿者名・候補のお店・確度・論調だけ。本文は保存しない（重複判定用のハッシュだけ）
//   - 批判的なお店は、そのお店だけ候補から外す（応援が目的。投稿全体をひとまとめに判定しない）
//   - 照合するのは 印西市内（inzai）＋周辺6市町（near）のお店だけ。範囲外の市町のお店は外す
//   - 1投稿から最大10店。それ以上は more_shops の印だけ付けて、運営が元の投稿を見て足す
//   - スイッチ（app_settings.gourmet_crawl.enabled）は既定オフ。1日の AI 呼び出しの上限（daily_ai_limit）を超えたら止める

import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { gourmetAreaOf, gourmetMunicipalityOf } from '@/lib/gourmet'
import type { GourmetAreaKind } from '@/lib/gourmet-areas'

export const GOURMET_CRAWL_MODEL = 'claude-haiku-4-5'
export const GOURMET_CRAWL_PURPOSE = 'gourmet_crawl_instagram'
export const GOURMET_CRAWL_SETTING = 'gourmet_crawl'
export const MAX_SHOPS_PER_POST = 10
export const DEFAULT_DAILY_AI_LIMIT = 40
/** 食レポだけに使うハッシュタグ（# は付けない）。個人のグルメ投稿を拾うため（2026-11-13 事業主決定）。
 *  イベントの候補づくりには使わない。Instagram の「7日で30語」の枠を使うので、増やすときは防災MAPの分と合わせて数える */
export const GOURMET_HASHTAGS = ['印西グルメ', '印西ランチ', '印西ディナー', '印西カフェ']
// Haiku 4.5 の単価（USD / 100万トークン）と円の換算（費用の記録用の目安）
const USD_PER_MTOK = { input: 1, output: 5 }
const JPY_PER_USD = 155

export type Tone = 'positive' | 'neutral' | 'negative'
export type Confidence = 'high' | 'mid' | 'low'

export type ExtractedShop = { name: string; area_hint: string; tone: Tone; confidence: Confidence; reason: string }
export type GourmetExtraction = { is_food_report: boolean; shops: ExtractedShop[]; more_than_10: boolean; note: string }

// 構造化出力のスキーマ（maxItems・型の配列・anyOf を多用すると 400 になるため、すべて string／boolean で持つ）
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_food_report', 'shops', 'more_than_10', 'note'],
  properties: {
    is_food_report: { type: 'boolean', description: '飲食店で食べた・飲んだ・買った体験を紹介する投稿なら true。イベントの告知・求人・店の宣伝だけ・飲食と無関係なら false' },
    more_than_10: { type: 'boolean', description: '紹介しているお店が10店を超えるなら true（shops には最初の10店だけ入れる）' },
    note: { type: 'string', description: '判断の補足（短く。無ければ空文字）' },
    shops: {
      type: 'array',
      description: '投稿が紹介している飲食店（最大10店・投稿に出てくる順）',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'area_hint', 'tone', 'confidence', 'reason'],
        properties: {
          name: { type: 'string', description: '店名（投稿に書かれた表記のまま。支店名があれば含める。分からなければ空文字）' },
          area_hint: { type: 'string', description: '場所の手がかり（市町名・町名・駅名・住所など、投稿に書かれたもの。無ければ空文字）' },
          tone: { type: 'string', enum: ['positive', 'neutral', 'negative'], description: 'このお店についての論調。positive＝好意的・おすすめ、neutral＝事実の紹介だけ、negative＝批判・不満・がっかり' },
          confidence: { type: 'string', enum: ['high', 'mid', 'low'], description: 'このお店を紹介しているという判断の確かさ' },
          reason: { type: 'string', description: '判断の理由（短く）' },
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = [
  'あなたは千葉県印西市の市民団体が作る「印西 食レポマップ」（地域の飲食店を応援する地図）の手伝いです。',
  'SNS の投稿の本文を読み、その投稿が飲食店の食レポかどうかと、紹介しているお店を答えます。',
  '- 1つの投稿で複数のお店を紹介していることがあります。お店ごとに分けて、出てくる順に最大10店まで答えます。',
  '- 論調はお店ごとに判断します。批判・不満・二度と行かない等は negative。PR・案件の表記があっても、紹介なら positive か neutral。',
  '- 店名は投稿の表記のまま書きます。推測で店名を作らないこと。ハッシュタグの地名（#印西 など）は area_hint に使ってよい。',
  '- 投稿が飲食店の紹介でない（イベント告知・求人・お店自身の宣伝だけ・料理教室・自炊・飲食と無関係）なら is_food_report を false にし、shops は空にします。',
].join('\n')

/** 本文の重複判定用のハッシュ（本文そのものは保存しない） */
export function captionHash(caption: string): string {
  return createHash('sha256').update(caption.normalize('NFKC').replace(/\s+/g, ' ').trim()).digest('hex')
}

export function estimateCostJpy(usage: { input: number; output: number }): number {
  return ((usage.input * USD_PER_MTOK.input + usage.output * USD_PER_MTOK.output) / 1_000_000) * JPY_PER_USD
}

export async function extractGourmet(client: Anthropic, caption: string, model = GOURMET_CRAWL_MODEL): Promise<{ extraction: GourmetExtraction; usage: { input: number; output: number } }> {
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [{ role: 'user', content: [{ type: 'text', text: `本文:\n${caption.slice(0, 2500)}` }] }],
  })
  const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  const extraction = JSON.parse(text) as GourmetExtraction
  extraction.shops = (extraction.shops ?? []).slice(0, MAX_SHOPS_PER_POST)
  return { extraction, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } }
}

// ---------- お店との照合 ----------

export type ShopEntry = { ref: string; name: string; branch?: string; address?: string; lat: number; lon: number; area: GourmetAreaKind; municipality: string | null }

/** 食レポマップの検索と同じ正規化（全角半角・大文字小文字・カタカナとひらがな・空白）＋記号を落とす */
export function normShopName(s: string): string {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･'’"“”「」『』()（）［］\[\]【】!！?？.。、,，~〜ー\-_/／&＆#＃@＠]/g, '')
}

// 地域の手がかりの判定（市内・周辺・範囲外・不明）は、画面からも使うので gourmet-area-class.ts に置く
import { hintIsOutOfRange } from '@/lib/gourmet-area-class'
export { hintIsOutOfRange }

// 一般的な語だけの店名（正規化した形）。地図に「ラーメン」「カフェ」のような名前のお店が実際にある
const GENERIC = new Set(['ラーメン', 'らーめん', '拉麺', 'カフェ', 'cafe', 'coffee', '珈琲', 'コーヒー', '喫茶', '喫茶店', '食堂', '寿司', 'すし', '鮨', '焼肉', '焼き肉', '居酒屋', 'パン', 'ベーカリー', 'bakery', 'レストラン', 'restaurant', 'そば', '蕎麦', 'うどん', '中華', '中華料理', '定食', '弁当', 'ピザ', 'pizza', 'バー', 'bar', '洋菓子', '和菓子', 'ケーキ', 'お好み焼き', 'とんかつ', 'カレー', 'たこ焼き', 'クレープ', 'ドーナツ', 'スイーツ', 'イタリアン', 'フレンチ', '和食', '洋食', 'ファストフード'].map((w) => normShopName(w)))

export type ShopMatch = { ref: string; name: string; area: GourmetAreaKind; municipality: string | null; score: number }

export function matchShop(name: string, hint: string, shops: ShopEntry[], limit = 5): ShopMatch[] {
  const q = normShopName(name)
  if (q.length < 2) return []
  const h = hint.normalize('NFKC')
  const out: ShopMatch[] = []
  for (const s of shops) {
    const full = normShopName(`${s.name}${s.branch ?? ''}`)
    const base = normShopName(s.name)
    let score = 0
    if (full === q || base === q) score = 100
    // 「ラーメン」「カフェ」のような一般的な語だけの名前は、部分一致の相手にしない
    // （2026-11-13 の試験で「つけ麺らーめん春樹…」が「ラーメン」という名前の別の店に当たった）
    else if (GENERIC.has(base) || GENERIC.has(q)) score = 0
    // 先頭がそろう（「ごま福堂 成田店」と「ごま福堂」など）
    else if (q.length >= 3 && base.length >= 3 && (base.startsWith(q) || q.startsWith(base))) score = 75
    // 投稿の店名が地図の店名の中にある（「宮﨑邸」と「茶房 宮﨑邸」、「東京オリーブ」と「スープパスタ&PIZZA専門店 東京オリーブ…」）
    else if (q.length >= 3 && base.includes(q)) score = 65
    // 地図の店名が投稿の店名の後ろにある（「十割蕎麦 彦兵衛」と「彦兵衛」）
    else if (base.length >= 3 && q.endsWith(base)) score = 60
    // それ以外で地図の店名が投稿の店名の中にあるだけのものは、長く特徴的な名前（6文字以上）のときだけ弱い候補にする
    else if (base.length >= 6 && q.includes(base)) score = 50
    if (!score) continue
    // 地域の手がかりが、お店の市町・住所と合えば上げる
    const muni = s.municipality?.replace(/[市町]$/, '') ?? ''
    if (muni && h.includes(muni)) score += 15
    if (s.address && h.length >= 2 && s.address.normalize('NFKC').includes(h.replace(/(市|町|駅|周辺|付近)$/, ''))) score += 10
    if (s.area === 'inzai') score += 3
    out.push({ ref: s.ref, name: s.branch ? `${s.name} ${s.branch}` : s.name, area: s.area, municipality: s.municipality, score })
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ja'))
  return out.slice(0, limit)
}

export type CandidateShop = {
  name: string
  area_hint: string
  tone: Tone
  confidence: Confidence
  reason: string
  /** 照合の結果。運営が選び直せる */
  matches: ShopMatch[]
  /** 自動で選んだお店（決まらなければ null＝お店未定／地図にないお店） */
  chosen_ref: string | null
  /** 'ok'＝候補・'unmatched'＝地図にないお店・'out_of_area'＝範囲外の市町・'negative'＝批判的なので外す */
  status: 'ok' | 'unmatched' | 'out_of_area' | 'negative'
}

/** AI の答えを、照合つきの候補のお店の並びにする */
export function buildCandidateShops(extraction: GourmetExtraction, shops: ShopEntry[]): CandidateShop[] {
  if (!extraction.is_food_report) return []
  return extraction.shops.filter((s) => s.name.trim()).map((s) => {
    const base = { name: s.name.trim().slice(0, 60), area_hint: s.area_hint.trim().slice(0, 60), tone: s.tone, confidence: s.confidence, reason: s.reason.slice(0, 120) }
    if (s.tone === 'negative') return { ...base, matches: [], chosen_ref: null, status: 'negative' as const }
    if (hintIsOutOfRange(s.area_hint)) return { ...base, matches: [], chosen_ref: null, status: 'out_of_area' as const }
    const matches = matchShop(s.name, s.area_hint, shops)
    // 1位がはっきり上（完全一致か前方一致・2位と差がある）なら自動で選ぶ。同点（チェーン店など）は運営が選ぶ
    const top = matches[0]
    const clear = top && top.score >= 75 && (!matches[1] || top.score - matches[1].score >= 10)
    return { ...base, matches, chosen_ref: clear ? top.ref : null, status: matches.length ? ('ok' as const) : ('unmatched' as const) }
  })
}

/** お店の一覧（食レポマップの osm-shops.json の area 付き＋市民が足したお店）を照合用にする */
export function shopEntriesFrom(
  osm: Array<{ id: string; name: string; branch?: string; address?: string; lat: number; lon: number; area?: string }>,
  citizen: Array<{ id: string; name: string; address: string | null; lat: number; lon: number }>,
): ShopEntry[] {
  const out: ShopEntry[] = []
  for (const s of osm) {
    const area = s.area === 'inzai' || s.area === 'near' ? s.area : gourmetAreaOf(s.lat, s.lon)
    if (!area) continue
    out.push({ ref: String(s.id).toLowerCase(), name: s.name, branch: s.branch, address: s.address, lat: s.lat, lon: s.lon, area, municipality: gourmetMunicipalityOf(s.lat, s.lon) })
  }
  for (const s of citizen) {
    const area = gourmetAreaOf(s.lat, s.lon)
    if (!area) continue
    out.push({ ref: `shop:${s.id}`, name: s.name, address: s.address ?? undefined, lat: s.lat, lon: s.lon, area, municipality: gourmetMunicipalityOf(s.lat, s.lon) })
  }
  return out
}
