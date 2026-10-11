// 災害情報の通知（2026-10-12 事業主指示）。
// 希望した会員（マイメニュー /me/edit のスイッチ・初期OFF）にだけ、ベル🔔＋Webプッシュで知らせる。
// きっかけは新しい定期実行を作らず、既存の巡回（公式発表・通行止め）と記録の保存に相乗りする。
// 停電は対象外：東京電力PGとの了承条件が「利用者が表示を選んだときだけ取得・常時巡回なし」のため。
import { notifyDisasterSubscribers } from '@/lib/notify'
import { DISASTER_CATEGORIES, type DisasterCategory } from '@/lib/disaster-notify-categories'

export const DISASTER_MAP_URL = 'https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/'

export { DISASTER_CATEGORIES, type DisasterCategory } from '@/lib/disaster-notify-categories'

const prefKeyOf = (key: DisasterCategory) => DISASTER_CATEGORIES.find((c) => c.key === key)!.prefKey

export type TimelineDraftLite = { title: string; body?: string | null; changeType?: string | null }

/**
 * 公式発表の1件（タイムラインに新しく入ったもの）が通知対象かを判定する。対象外は null。
 * - 気象警報：気象庁の印西市の発表で「警報（発表）」を含むもの（特別警報を含む。注意報・継続・解除は対象外）
 * - 避難情報：市の防災速報・市の災害情報で、緊急安全確保／避難指示／高齢者等避難を含み、解除でないもの
 */
export function classifyTimelineDraft(
  sourceKind: string,
  draft: TimelineDraftLite,
): { category: 'evac' | 'warning'; title: string; body: string } | null {
  const title = draft.title ?? ''
  const text = `${title} ${draft.body ?? ''}`
  if (draft.changeType === 'cancel') return null

  if (sourceKind === 'jma-warning') {
    if (!/警報（発表）/.test(title)) return null
    const special = /特別警報/.test(title)
    return {
      category: 'warning',
      title: `${special ? '🚨 特別警報' : '⚠️ 警報'}：${title.replace(/^印西市：/, '印西市 ')}`.slice(0, 120),
      body: '気象庁の発表です。くわしくは防災MAPで確認してください。',
    }
  }

  if (sourceKind === 'city-alert-xml' || sourceKind === 'city-category-html') {
    if (/解除/.test(text)) return null
    const level = /緊急安全確保/.test(text) ? '警戒レベル5' : /避難指示/.test(text) ? '警戒レベル4' : /高齢者等避難/.test(text) ? '警戒レベル3' : null
    if (!level) return null
    return {
      category: 'evac',
      title: `📢 印西市の避難情報（${level}相当）：${title}`.slice(0, 120),
      body: '市の発表です。対象地域と最新の内容は印西市の公式情報で確認してください。',
    }
  }
  return null
}

async function send(
  category: DisasterCategory,
  dedupeKey: string,
  title: string,
  body: string,
  dedupeMinutes: number,
) {
  return notifyDisasterSubscribers({
    prefKey: prefKeyOf(category),
    dedupeKey: `${category}-${dedupeKey}`,
    title,
    body,
    linkBase: DISASTER_MAP_URL,
    dedupeMinutes,
  })
}

/** 公式発表の新着から通知を出す（巡回が保存した「新規」だけを渡す） */
export async function notifyTimelineDrafts(
  sourceKind: string,
  drafts: Array<TimelineDraftLite & { externalKey: string; occurredAt?: string | null }>,
) {
  // 情報源を足した直後や表を空にした後の取り込みで、過去の発表が一斉に通知されないよう、
  // 発表から3時間以内のものだけを対象にする
  const cutoff = Date.now() - 3 * 3600_000
  for (const draft of drafts) {
    const at = draft.occurredAt ? Date.parse(draft.occurredAt) : NaN
    if (Number.isFinite(at) && at < cutoff) continue
    const hit = classifyTimelineDraft(sourceKind, draft)
    if (!hit) continue
    await send(hit.category, draft.externalKey, hit.title, hit.body, 24 * 60)
  }
}

/** 通行止めの新規発表（印西市周辺のもの）。同じ巡回の複数件は1通にまとめる */
export async function notifyNewClosures(
  closures: Array<{ key: string; road: string; place: string; reason?: string; inArea: boolean }>,
) {
  const fresh = closures.filter((c) => c.inArea)
  if (fresh.length === 0) return
  const head = fresh[0]
  const label = [head.road, head.place].filter(Boolean).join(' ') || '場所は防災MAPで確認'
  const more = fresh.length > 1 ? `（ほか${fresh.length - 1}件）` : ''
  await send(
    'closure',
    fresh.map((c) => c.key).sort().join('|').slice(0, 120),
    `🚧 通行止めの発表：${label}${more}`.slice(0, 120),
    '役所の発表です。迂回の参考は防災MAPで確認してください。',
    24 * 60,
  )
}

/**
 * 通れない冠水道路の追加（市民の記録・SNSの確度「高」）。多数の投稿で通知が続かないよう、
 * 10分ごとに最大1通（その間の追加は次の通知か防災MAPで確認）。
 */
export async function notifyFloodRoadAdded(source: 'citizen' | 'sns', place?: string) {
  const bucket = Math.floor(Date.now() / (10 * 60_000))
  const where = place ? `：${place}` : ''
  await send(
    'flood',
    `b${bucket}`,
    `🚫 通れない冠水道路の情報が追加されました${where}`.slice(0, 120),
    source === 'citizen'
      ? '市民の記録です（未確認）。場所と最新の状況は防災MAPで確認してください。'
      : 'SNSの投稿から読み取った未確認情報です。場所は防災MAPで確認してください。',
    10,
  )
}

/** 印旛沼・手賀沼などが危険水位に達したとき（防災MAPの水位取得時に判定。同じ観測所は6時間に1回） */
export async function notifyRiverDanger(stationName: string, level: string) {
  await send(
    'river',
    stationName,
    `🌊 ${stationName}が危険水位の目安に達しました（${level}）`.slice(0, 120),
    '水位の最新値は防災MAPで確認してください。避難の判断は市の避難情報に従ってください。',
    6 * 60,
  )
}
