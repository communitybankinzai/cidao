// 千葉県 水防情報「水位グラフ」の個別ページ（観測所ごと）から、10分値と基準水位を読む
// （river-level/route.ts から切り出し。2026-09-24）。読み取りをテストで確かめられるよう lib に置く。挙動は route.ts にあったときと同じ。

export type Levels = { standby: number | null; caution: number | null; danger: number | null; planHigh: number | null }

export type Reading = { time: string; level: number }

// 「---」（基準なし）のときに次の行の数字を拾わないよう、ラベル直後の空白・タグだけを飛ばす。
// 戻り値 undefined＝ラベル自体が無い、null＝基準なし（---）
export function readLevel(html: string, label: string): number | null | undefined {
  const m = html.match(new RegExp(`${label}(?:\\s|&nbsp;|<[^>]*>)*([0-9]+\\.[0-9]+m|---)`))
  if (!m) return undefined
  return m[1] === '---' ? null : Number(m[1].slice(0, -1))
}

// 表は1行に「HH時の6値（00〜50分）」を左右2つ（0〜11時・12〜23時）並べている
export function parseStationPage(html: string, fallback: Levels) {
  const dateMatch = html.match(/(\d{4})年(\d{2})月(\d{2})日/)
  if (!dateMatch) throw new Error('観測日が読めません')
  const [, y, mo, d] = dateMatch

  const readings: Reading[] = []
  const block = /class="title">(\d{2})<\/th>((?:\s*<td[^>]*>[^<]*<\/td>){6})/g
  for (const m of html.matchAll(block)) {
    const hour = m[1]
    const cells = [...m[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1].replace(/&nbsp;/g, '').trim())
    cells.forEach((text, i) => {
      if (!/^\d+\.\d+$/.test(text)) return // 空欄（未受信）・***（欠測）・---（無効）
      const level = Number(text)
      if (!(level > 0)) return // 0.00 は欠測扱い
      readings.push({ time: `${y}-${mo}-${d}T${hour}:${String(i * 10).padStart(2, '0')}:00+09:00`, level })
    })
  }
  readings.sort((a, b) => a.time.localeCompare(b.time))

  const pick = (label: string, fb: number | null) => {
    const v = readLevel(html, label)
    return v === undefined ? fb : v
  }
  const levels: Levels = {
    standby: pick('水防団待機水位', fallback.standby),
    caution: pick('はん濫注意水位', fallback.caution),
    danger: pick('はん濫危険水位', fallback.danger),
    planHigh: pick('計画高水位相当', fallback.planHigh),
  }
  return { readings, levels }
}
