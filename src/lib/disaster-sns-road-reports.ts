import places from './disaster-sns-road-places.json'

export const ROAD_EVENT_SINCE = '2026-09-20'
export const ROAD_EVENT_START = '2026-09-20T00:00:00+09:00'
export const ROAD_BACKFILL_KEY = 'disaster_sns_road_backfill_typhoon25_v1'
type Candidate = {
  id: string; platform: string; permalink: string; body_text: string; posted_at: string
  latitude?: number | null; longitude?: number | null; review_status?: string
  raw_payload?: Record<string, unknown> | null
}
export type SnsRoadReport = {
  id: string; kind: 'passed' | 'blocked'; lat: number; lng: number
  locationName: string; locationBasis: string; locationSourceUrl: string
  observedAt: string | null; postedAt: string; sourceUrl: string; platform: string
  text: string; verification: 'unconfirmed'
}
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ')
const LOCAL_CONTEXT = /印西|千葉ニュータウン|千葉NT|印旛|本埜|千葉県|白井|成田|佐倉|八千代|栄町|利根町|取手/
const UNSURE = /[?？]|だろう|でしょうか|かもしれ|らしい|とのこと|と聞|と聞い|そうです|そうだ|模様|予定|見込み|見込ま|恐れ|おそれ|可能性|もし|場合|なら|たら|情報ください|教えて|どうですか|そうな|かどうか|られそう/
const PASSED = /(?:通れた|通れました|通れます|通れる|通行できた|通行できました|通行可能|通過できた|通過しました|渡れた|渡れました|走れた|走れました)(?![\p{L}]*ない)/u
const BLOCKED = /通れなかった|通れませんでした|通れない|通れません|通行できなかった|通行できない|通行できません|通行不可|通行不能|通行止め|通行止|渡れない|渡れなかった/
const NEGATED = /(?:通行止め?|通行不可|通行不能).{0,5}(?:ではな|じゃな|ではありませ|でなく|になっていな)|(?:通れた|通れる|通れない|通行可能).{0,5}(?:わけでは|とは限|というわけ|とは言え)|通れなくはな/

export function roadClaim(text: string): { kind: 'passed' | 'blocked'; sentence: string } | null {
  const value = normalize(text.replace(/https?:\/\/\S+/g, ' '))
  if (/^\s*(?:RT|QT)\s*@/i.test(value) || /(?:転載|引用|ニュース|記事による|HPより|ホームページより)/.test(value)) return null
  const sentences = value.split(/[。!！\n]/).map(x => x.trim()).filter(Boolean)
  const claims: Array<{ kind: 'passed' | 'blocked'; sentence: string }> = []
  for (const sentence of sentences) {
    if (!PASSED.test(sentence) && !BLOCKED.test(sentence)) continue
    if (UNSURE.test(sentence) || NEGATED.test(sentence) || /「[^」]*(?:通れ|通行)[^」]*」|通れない道|通れた道/.test(sentence)) return null
    const passed = PASSED.test(sentence), blocked = BLOCKED.test(sentence)
    if (passed === blocked) return null
    claims.push({ kind: passed ? 'passed' : 'blocked', sentence })
  }
  if (!claims.length || new Set(claims.map(c => c.kind)).size !== 1) return null
  return claims[0]
}

// Observation time is never silently replaced with the posting time.
export function roadObservedAt(text: string, postedAt: string): string | null {
  const post = new Date(postedAt)
  if (!Number.isFinite(post.getTime())) return null
  const t = normalize(text)
  if (/(?:一昨日|先週|先月|去年|昨年|前日|数日前)/.test(t)) return null
  const time = t.match(/(?:(午前|午後)\s*)?(\d{1,2})(?:時(?:\s*(\d{1,2})分)?|:(\d{2}))/)
  if (!time) return /(?:いま|今現在|たった今|今さっき)/.test(t) ? post.toISOString() : null
  let hour = Number(time[2]); const minute = Number(time[3] || time[4] || 0)
  if (hour > 23 || minute > 59 || (time[1] && (hour < 1 || hour > 12))) return null
  if (time[1]) hour = hour % 12 + (time[1] === '午後' ? 12 : 0)
  const jst = new Date(post.getTime() + 9 * 3600000)
  const md = t.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/)
  const year = md?.[1] ? Number(md[1]) : jst.getUTCFullYear()
  const month = md ? Number(md[2]) : jst.getUTCMonth() + 1
  const day = md ? Number(md[3]) : jst.getUTCDate()
  const dayCheck = new Date(Date.UTC(year, month - 1, day))
  if (dayCheck.getUTCMonth() !== month - 1 || dayCheck.getUTCDate() !== day) return null
  const ms = Date.UTC(year, month - 1, day, hour - 9, minute) - (!md && /昨日/.test(t) ? 86400000 : 0)
  if (ms > post.getTime() + 15 * 60000) return null
  return new Date(ms).toISOString()
}

function explicitPoint(text: string) {
  const matches = [...text.matchAll(/(?:緯度\s*|geo:|[?&](?:q|query|ll)=)(-?\d{1,2}\.\d+)\s*(?:[,，]|[,，]?\s*経度\s*)(-?\d{2,3}\.\d+)/g)]
  if (matches.length !== 1) return null
  const lat = Number(matches[0][1]), lng = Number(matches[0][2])
  if (!inArea(lat, lng)) return null
  return { lat, lng, locationName: '投稿に明記された地点', locationBasis: '投稿本文・地図リンクに明記された緯度経度（未確認）', locationSourceUrl: '' }
}
function inArea(lat: number, lng: number) { return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 35.72 && lat <= 35.92 && lng >= 140.03 && lng <= 140.34 }

export function classifyRoadCandidate(candidate: Candidate): { report: SnsRoadReport | null; reason: 'excluded' | 'needs-location' | 'ambiguous-location' | 'located' } {
  if (candidate.review_status === 'dismissed' || !/^https:\/\//i.test(candidate.permalink)) return { report: null, reason: 'excluded' }
  const raw = candidate.raw_payload || {}
  const embed = raw.embed as { $type?: string } | undefined
  if (raw.is_quote_post === true || embed?.$type?.includes('record')) return { report: null, reason: 'excluded' }
  const text = candidate.body_text || '', claim = roadClaim(text)
  if (!claim) return { report: null, reason: 'excluded' }
  // Do not assign a bridge mentioned in a separate sentence to the reported road.
  const allMentions = places.points.filter(p => p.aliases.some(a => normalize(text).includes(normalize(a))))
  if (allMentions.length > 1) return { report: null, reason: 'ambiguous-location' }
  let location = explicitPoint(text)
  if (!location && LOCAL_CONTEXT.test(normalize(text))) {
    const matches = allMentions.filter(p => p.aliases.some(a => claim.sentence.includes(normalize(a))))
    if (matches.length === 1) {
      const p = matches[0]
      location = { lat: p.lat, lng: p.lng, locationName: `${p.name}付近`, locationBasis: p.basis, locationSourceUrl: p.sourceUrl }
    }
  }
  // Generic social geotags locate the post, not necessarily the reported road; never use them implicitly.
  if (!location) return { report: null, reason: 'needs-location' }
  const observedAt = roadObservedAt(text, candidate.posted_at)
  if (observedAt && new Date(observedAt).getTime() < new Date(ROAD_EVENT_START).getTime()) return { report: null, reason: 'excluded' }
  return { reason: 'located', report: { id: candidate.id, kind: claim.kind, ...location, observedAt,
    postedAt: candidate.posted_at, sourceUrl: candidate.permalink, platform: candidate.platform,
    text: text.slice(0, 1200), verification: 'unconfirmed' } }
}

export function summarizeRoadCandidates(candidates: Candidate[], since = ROAD_EVENT_SINCE) {
  const roadReports: SnsRoadReport[] = []
  let needsLocation = 0, ambiguous = 0
  for (const candidate of candidates) {
    const result = classifyRoadCandidate(candidate)
    if (result.report) roadReports.push(result.report)
    else if (result.reason === 'needs-location') needsLocation++
    else if (result.reason === 'ambiguous-location') ambiguous++
  }
  return { roadReports, roadSummary: { since, candidates: candidates.length, located: roadReports.length, needsLocation, ambiguous,
    credit: places.credit, platforms: ['threads', 'instagram', 'bluesky'],
    note: 'SNS由来の未確認情報。点は投稿が指す場所の目安で、道の通行を保証しません。観測時刻不明の投稿は投稿時刻を表示します。' } }
}
