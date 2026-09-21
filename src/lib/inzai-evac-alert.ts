// 印西市防災速報から市の避難情報（高齢者等避難・避難指示・緊急安全確保）を拾う（2026-09-21）。
// 防災MAPの地図上の警告帯（/api/disaster/evac-alert）が使う。
import { CITY_PORTAL_URL, type OfficialUpdate } from '@/lib/inzai-city-alerts'

const EXPIRE_HOURS = 24

// 強い順。1つの放送に複数あれば強いほうを採る
const LEVELS = [
  { level: 5, label: '緊急安全確保' },
  { level: 4, label: '避難指示' },
  { level: 3, label: '高齢者等避難' },
] as const

const KEYWORD = /(緊急安全確保|避難指示|高齢者等避難)/
// 「避難指示を解除し、高齢者等避難を発令」のような放送は、解除した側を取り除いてから判定する
const CANCELLED = /(緊急安全確保|避難指示|高齢者等避難)[^。\n]{0,20}?解除/g

// 防災速報の日時は「2026/09/21 14:30:01」（日本時間・タイムゾーン表記なし）
export function parsePublishedAt(value: string) {
  const m = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +(m[6] ?? 0))
}

// 対象の部分だけ取り出す（実例 2026-09-21）
//   「…高まったため、土砂災害警戒区域および土砂災害のおそれがある箇所に対し」→ 土砂災害警戒区域および…箇所
//   「…上昇していることから、印旛沼周辺の低い土地にお住いの方に対し」→ 印旛沼周辺の低い土地
function extractArea(message: string) {
  const m = message.replace(/\s+/g, '').match(/([^。「」]{2,80}?)に対し/)
  if (!m) return ''
  const tail = m[1].split('、').pop() ?? ''
  return tail.replace(/に(?:お住まい|お住い|住んでいる|いる)の?方$/, '').replace(/の方$/, '').slice(0, 40)
}

// 解除の放送がどの発令を解除したかを、災害の種類・場所の語で対応づける。
// 語が1つも無い解除放送は、それより前の発令をすべて解除したものとみなす（安全側ではなく、出しっぱなしを避ける側）
const AREA_TOKENS = ['土砂', '印旛沼', '手賀沼', '利根川', '洪水', '浸水', '全域']
function areaTokens(text: string) {
  return AREA_TOKENS.filter((t) => text.includes(t))
}

// 放送文を文ごとに分ける（句点と改行）。「一部解除」の放送では、解除した文と継続する文が同じ放送に並ぶため、
// 文ごとに見ないと取り違える（2026-09-22 7:00「土砂災害警戒区域の避難指示は解除…印旛沼の避難指示は継続中」で、
// 継続中の印旛沼まで解除扱いにし、さらに「継続中」の文を新しい発令と数えた）
function sentences(text: string) {
  return text.split(/[。\n]/).map((x) => x.trim()).filter(Boolean)
}
const CANCEL_SENTENCE = /(緊急安全確保|避難指示|高齢者等避難)[^。\n]{0,20}?解除/
const CONTINUE_SENTENCE = /継続|引き続き/

export type EvacAlert = {
  level: number
  label: string
  area: string
  title: string
  message: string
  publishedAt: string
  sourceUrl: string
}

export function detectEvacAlerts(updates: OfficialUpdate[], now: number) {
  const relevant = updates
    .filter((u) => KEYWORD.test(`${u.title}\n${u.message}`))
    .sort((a, b) => parsePublishedAt(a.publishedAt) - parsePublishedAt(b.publishedAt)) // 古い順に積んで、解除で外す
  let active: Array<EvacAlert & { tokens: string[] }> = []
  let cancelledAny = false
  for (const u of relevant) {
    const text = `${u.title}\n${u.message}`
    const parts = sentences(text)
    const cancelParts = parts.filter((x) => CANCEL_SENTENCE.test(x))
    if (cancelParts.length) {
      // 解除した地域の語は、解除を述べた文からだけ拾う
      const tokens = areaTokens(cancelParts.join('\n'))
      active = tokens.length ? active.filter((a) => !a.tokens.some((t) => tokens.includes(t))) : []
      cancelledAny = true
    }
    // 新しい発令かどうかは、解除の文と「継続中」「引き続き」の文を除いて判断する
    // （「避難指示を解除し、高齢者等避難を発令」のように同じ文に並ぶときは、解除した部分を除いた残りを見る）
    const issueText = parts
      .map((x) => (CANCEL_SENTENCE.test(x) ? x.replace(CANCELLED, '') : x))
      .filter((x) => !CONTINUE_SENTENCE.test(x))
      .join('\n')
    const found = LEVELS.find((l) => issueText.includes(l.label))
    if (!found) continue
    active.push({
      level: found.level,
      label: found.label,
      area: extractArea(u.message),
      title: u.title,
      message: u.message,
      publishedAt: u.publishedAt,
      sourceUrl: u.sourceUrl || CITY_PORTAL_URL,
      tokens: areaTokens(u.message),
    })
  }
  const fresh = active.filter((a) => {
    const ms = parsePublishedAt(a.publishedAt)
    return !Number.isFinite(ms) || now - ms <= EXPIRE_HOURS * 3600_000
  })
  const alerts: EvacAlert[] = fresh.reverse().map(({ tokens: _tokens, ...rest }) => rest) // 新しい順
  const reason = alerts.length ? 'active' : active.length ? 'expired' : cancelledAny ? 'cancelled' : 'none'
  return { alerts, reason }
}
