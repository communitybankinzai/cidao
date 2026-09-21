// 鉄道・バスの運休情報から「もう出さなくてよいもの」を落とす判定。
//
// 登録（どの区間が止まっているか）は人が行い、ここでやるのは解除だけ。
// 市が運転再開を発表すると「災害時の公共交通のご案内」の本文から運休の記述が消えるので、
// 取り込み済みのその本文と突き合わせて落とす。**消す方向だけの自動化**にしてある
// （誤って消しても「情報なし」になるだけ。誤った区間を赤く塗り続ける方が危険）。
// 本文が取れないときは落とさない（＝期限切れまで表示を保つ）。

export type RailEntry = {
  line?: string
  from?: string
  to?: string
  state?: string
  detail?: string
  announcedAt?: string
  expiresAt?: string
  /**
   * 出典の種類。既定（未指定）は市の「災害時の公共交通のご案内」。
   * 'operator' は鉄道会社の発表を運営が確認して自分の言葉で登録したもの（2026-09-21：北総線と同じ線路の
   * スカイアクセス線が市の案内に載らなかったため）。市のページとは照合せず、有効期限だけで消す。
   * 事業者のページを機械で取得することはしない（北総鉄道は運行情報の転載・複写を禁じている）
   */
  sourceType?: 'city' | 'operator'
  sourceLabel?: string
  sourceUrl?: string
  /** 地図の線の名前と違う路線名で見せたいとき（例：北総線の線路を走る成田スカイアクセス線） */
  lineLabel?: string
}

/** 市のページと照合する項目か（運営が確認した事業者発表の項目は照合しない） */
export function isCitySourced(entry: { sourceType?: string }) {
  return entry.sourceType !== 'operator'
}

export type BusEntry = {
  name?: string
  state?: string
  detail?: string
  announcedAt?: string
  expiresAt?: string
}

export type RailStatus = {
  updatedAt?: string
  checkedAt?: string
  note?: string
  source?: { label?: string; url?: string }
  railways?: RailEntry[]
  buses?: BusEntry[]
}

export type ClearedReason = { what: string; why: string }

/** 発表から何時間で自動的に地図から消すか（項目ごとの expiresAt が無いとき） */
export const DEFAULT_TTL_HOURS = 12

/** 本文にこれが1つも無ければ「もう止まっていない」とみなす */
export const DISRUPTION_WORDS = [
  '運休', '見合わせ', '遅れ', '遅延', '運転を取りやめ', '折り返し運転', '直通運転を中止',
]

export function isExpired(entry: { expiresAt?: string; announcedAt?: string }, now = Date.now()) {
  const limit = entry.expiresAt
    ? Date.parse(entry.expiresAt)
    : entry.announcedAt
      ? Date.parse(entry.announcedAt) + DEFAULT_TTL_HOURS * 3600 * 1000
      : NaN
  if (!Number.isFinite(limit)) return false
  return now > limit
}

function hasDisruptionWord(pageText: string) {
  return DISRUPTION_WORDS.some((word) => pageText.includes(word))
}

/** 市の案内ページ本文に、その区間の運休がまだ書かれているか */
export function railStillInPage(entry: RailEntry, pageText: string) {
  if (!hasDisruptionWord(pageText)) return false
  const from = (entry.from ?? '').trim()
  const to = (entry.to ?? '').trim()
  if (!from || !to) return true
  // 「成田駅～我孫子駅間」のように両端の駅名が出る書き方を想定する
  return pageText.includes(from) && pageText.includes(to)
}

export function busStillInPage(entry: BusEntry, pageText: string) {
  if (!hasDisruptionWord(pageText)) return false
  // 「路線バス 六合路線（小林駅～…）」から、かっこ前の語で照合する
  const name = (entry.name ?? '').split('（')[0].replace(/^路線バス\s*/, '').trim()
  if (!name) return true
  return pageText.includes(name)
}

/**
 * 表示してよい運休情報だけを残す。
 * pageText が空（市の案内が取れていない）ときは、期限切れだけで判定する。
 */
export function filterRailStatus(status: RailStatus, pageText: string, now = Date.now()) {
  const cleared: ClearedReason[] = []

  const railways = (status.railways ?? []).filter((entry) => {
    const label = `${entry.from ?? '?'}〜${entry.to ?? '?'}`
    if (isExpired(entry, now)) {
      cleared.push({ what: label, why: '発表から時間が経ったため' })
      return false
    }
    if (pageText && isCitySourced(entry) && !railStillInPage(entry, pageText)) {
      cleared.push({ what: label, why: '市の案内から記述が消えたため' })
      return false
    }
    return true
  })

  const buses = (status.buses ?? []).filter((entry) => {
    const label = String(entry.name ?? 'バス')
    if (isExpired(entry, now)) {
      cleared.push({ what: label, why: '発表から時間が経ったため' })
      return false
    }
    if (pageText && !busStillInPage(entry, pageText)) {
      cleared.push({ what: label, why: '市の案内から記述が消えたため' })
      return false
    }
    return true
  })

  return { railways, buses, cleared }
}
