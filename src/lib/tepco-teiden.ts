// 東京電力パワーグリッド「停電情報」の市区町村 XML（例：flash/xml/12231000000.xml＝印西市）を読む。
//
// 形（2026-09-28 に公開ページの JavaScript で確認）：
//   <東京電力停電情報>
//     <タイトル>印西市</タイトル>
//     <停電軒数>…</停電軒数>          ← 市全体（停電が無いときは無い）
//     <エリア コード="…"><名前>…</名前><停電軒数>…</停電軒数></エリア>  ← 地区ごと
//     <地域詳細情報>…</地域詳細情報>
//     <更新日時>202609281419</更新日時>
//   </東京電力停電情報>
// 軒数の表示は東電の画面（utility.js の convertDisplayBlackOuts）と同じにする：10未満は「10軒未満」、それ以外は「約N軒」。
// 数値を加工しない約束（2026-09-28 東電PGの承知）なので、表示の文字列はこの規則以外で作らない。
// 発生時刻・復旧見込みはこの XML に無い（町丁目のページ側）。取得は市の XML 1件だけと約束しているので扱わない。

export type TeidenArea = {
  code: string
  district: string
  households: number
  display: string
}

export type TeidenParsed = {
  title: string
  updatedAt: string | null // ISO（日本時間 +09:00）
  total: { households: number; display: string } | null
  areas: TeidenArea[]
  detail: string
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  return m ? m[1].trim() : null
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export function displayHouseholds(n: number): string {
  return n < 10 ? '10軒未満' : `約${n}軒`
}

function toCount(text: string | null): number | null {
  if (text == null) return null
  const t = text.replace(/[,\s]/g, '')
  if (!/^\d+$/.test(t)) return null
  return Number(t)
}

// 「202609281419」→ 2026-09-28T14:19:00+09:00
export function parseTeidenTime(text: string | null): string | null {
  const m = (text ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`
}

export function parseTeidenXml(xml: string): TeidenParsed {
  if (!/<東京電力停電情報[\s>]/.test(xml)) throw new Error('unexpected_format')
  // 市全体の軒数は <エリア> の外にある最初の <停電軒数>
  const outer = xml.replace(/<エリア[\s>][\s\S]*?<\/エリア>/g, '')
  const totalCount = toCount(tag(outer, '停電軒数'))
  const areas: TeidenArea[] = []
  for (const m of xml.matchAll(/<エリア(\s[^>]*)?>([\s\S]*?)<\/エリア>/g)) {
    const code = (m[1] ?? '').match(/コード\s*=\s*"([^"]*)"/)?.[1] ?? ''
    const n = toCount(tag(m[2], '停電軒数'))
    if (n == null || n <= 0) continue // 東電の画面も、軒数が空の地区は出さない
    areas.push({ code, district: decodeEntities(tag(m[2], '名前') ?? ''), households: n, display: displayHouseholds(n) })
  }
  return {
    title: decodeEntities(tag(xml, 'タイトル') ?? ''),
    updatedAt: parseTeidenTime(tag(xml, '更新日時')),
    total: totalCount != null && totalCount > 0 ? { households: totalCount, display: displayHouseholds(totalCount) } : null,
    areas,
    detail: decodeEntities(tag(xml, '地域詳細情報') ?? ''),
  }
}
