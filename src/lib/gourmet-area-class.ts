// 食レポの候補：お店の地域の手がかり（AI が読み取った住所や地域の文）から、地域の区分を決める（2026-11-13）。
// 依存の無い純粋な関数だけを置く（管理画面のクライアント部品からも使うので、サーバー専用の部品を混ぜない）。
//   inzai   … 印西市（千葉ニュータウン・牧の原・木下・小林・印旛を含む）
//   near    … 周辺6市町（白井市・栄町・柏市・我孫子市・成田市・佐倉市）
//   out     … 範囲の外（千葉県のほかの市町村・東京・茨城など）
//   unknown … 手がかりから決められない（住所が無い・町名だけ）

export type AreaClass = 'inzai' | 'near' | 'out' | 'unknown'

const INZAI_WORDS = ['印西', '千葉ニュータウン', '牧の原', '木下', '小林', '印旛']
const NEAR_WORDS = ['白井', '栄町', '柏', '我孫子', '成田', '佐倉']
// 範囲の外としてよく出る市町村名。千葉県の残りの市町村と、隣の都県
const OUT_WORDS = [
  '千葉市', '銚子', '市川', '船橋', '館山', '木更津', '松戸', '野田', '茂原', '東金', '旭市', '習志野', '勝浦', '市原', '流山', '八千代',
  '鴨川', '鎌ケ谷', '鎌ヶ谷', '君津', '富津', '浦安', '四街道', '袖ケ浦', '袖ヶ浦', '八街', '富里', '南房総', '匝瑳', '香取', '山武',
  'いすみ', '大網白里', '酒々井', '神崎町', '多古', '東庄', '九十九里', '芝山', '横芝光', '一宮町', '睦沢', '長生', '白子町', '長柄', '長南',
  '大多喜', '御宿', '鋸南', '取手', '龍ケ崎', '龍ヶ崎', '東京', '茨城', '埼玉', '神奈川', '栃木',
]

/** 地域の手がかりから区分を決める。印西・周辺6市町の名前が1つでもあれば範囲内（内側の区分を優先）。何も当たらなければ unknown */
export function hintAreaClass(hint: string | null | undefined): AreaClass {
  const h = String(hint ?? '').normalize('NFKC')
  if (!h) return 'unknown'
  if (INZAI_WORDS.some((w) => h.includes(w))) return 'inzai'
  if (NEAR_WORDS.some((w) => h.includes(w))) return 'near'
  if (OUT_WORDS.some((w) => h.includes(w))) return 'out'
  return 'unknown'
}

/** 範囲外か（巡回の照合の前の足切りに使う） */
export function hintIsOutOfRange(hint: string): boolean {
  return hintAreaClass(hint) === 'out'
}

// ---- 候補の絞り込みと並べ替え（管理画面） ----
export type AreaFilter = 'inzai' | 'near' | 'all'
const RANK: Record<AreaClass, number> = { inzai: 0, unknown: 1, near: 2, out: 3 }

/** 1つの候補（1投稿・複数店）の区分は、お店の中でいちばん内側のもの */
export function candidateAreaClass(shops: Array<{ status: string; area_hint: string; matches?: Array<{ area?: string }> }>): AreaClass {
  let best: AreaClass = 'out'
  for (const s of shops) {
    const m = s.matches?.[0]?.area
    const c: AreaClass = s.status === 'out_of_area' ? 'out' : m === 'inzai' || m === 'near' ? m : hintAreaClass(s.area_hint)
    if (RANK[c] < RANK[best]) best = c
  }
  return shops.length === 0 ? 'unknown' : best
}

/** 絞り込み：市内のみ（市内＋不明）／市内＋周辺6市町（＋不明）／すべて */
export function areaVisible(c: AreaClass, filter: AreaFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'near') return c !== 'out'
  return c === 'inzai' || c === 'unknown'
}

/** 並べ替えの順（小さいほど上）：市内→不明→周辺→範囲外 */
export function areaRank(c: AreaClass): number {
  return RANK[c]
}
