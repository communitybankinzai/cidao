// 災害情報の通知（2026-10-12 事業主指示）。
// 希望した会員（マイメニュー /me/edit のスイッチ・初期OFF）にだけ、ベル🔔＋Webプッシュで知らせる。
// きっかけは新しい定期実行を作らず、既存の巡回（公式発表・通行止め）と記録の保存に相乗りする。
// 消防情報（2026-10-14追加）は、防災MAPの fire-incidents.json（CBI手元の見張りが公開）を巡回のついでに読む。
// 停電は対象外：東京電力PGとの了承条件が「利用者が表示を選んだときだけ取得・常時巡回なし」のため。
import { createHmac, timingSafeEqual } from 'node:crypto'
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

// ---- 消防情報（印西地区消防組合の災害案内メール・CBIが受信して公開した fire-incidents.json）----
// 手元の見張りは CiDAO に何も送らないため、既存の災害タイムライン巡回のついでに公開JSONを読んで通知する。
// 救急支援活動（ems）は件数が多く火災ではないので対象外。

export const FIRE_INCIDENTS_URL = 'https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/fire-incidents.json'

export type FireIncidentLite = {
  id?: string
  kind?: string
  status?: string
  addressText?: string
  receivedAtIso?: string
}

const FIRE_KIND_LABEL: Record<string, { emoji: string; label: string }> = {
  fire: { emoji: '🔥', label: '火災' },
  investigating: { emoji: '🔍', label: '調査活動・火災の疑い' },
  accident: { emoji: '💥', label: '事故' },
}

/** 受信からこれより古い分は通知しない（情報源の追加直後や復旧後に、過去分が一斉に鳴らないように） */
export const FIRE_NOTIFY_MAX_AGE_MS = 3 * 3600_000

/** 消防情報の1件が通知対象なら通知の文面を返す。対象外は null */
export function classifyFireIncident(
  inc: FireIncidentLite,
  now: number = Date.now(),
): { dedupeKey: string; title: string; body: string } | null {
  if (!inc.id || inc.status !== 'active') return null
  const k = FIRE_KIND_LABEL[inc.kind ?? '']
  if (!k) return null
  const at = Date.parse(inc.receivedAtIso ?? '')
  if (!Number.isFinite(at) || now - at > FIRE_NOTIFY_MAX_AGE_MS) return null
  const addr = (inc.addressText ?? '').trim()
  const place = addr ? `${/^白井市/.test(addr) ? '' : '印西市'}${addr}付近` : '場所は防災MAPで確認'
  return {
    dedupeKey: inc.id,
    title: `${k.emoji} 消防情報（${k.label}）：${place}`.slice(0, 120),
    body: '印西地区消防組合のメール配信をCBIが受信した情報です（消防の公式な発表そのものではありません）。場所は防災MAPの「消防情報」で確認してください。',
  }
}

/**
 * 手元の見張り（fire_mail_watch.py）が新着を見つけた1件を、公開や巡回を待たずに通知するための合言葉。
 * Supabase のサービスキーから作る派生値（キー本体は戻せない）。新しい環境変数は増やさない。
 * 見張りは公開前でもこの口を呼ぶ。通知の重複は巡回側と同じ incident id で防ぐ。
 */
export function fireNotifyToken(serviceKey: string): string {
  return createHmac('sha256', serviceKey).update('disaster-fire-notify').digest('hex')
}

export function verifyFireNotifyToken(serviceKey: string, token: string | null | undefined): boolean {
  if (!serviceKey || !token) return false
  const expected = Buffer.from(fireNotifyToken(serviceKey), 'utf8')
  const given = Buffer.from(String(token), 'utf8')
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** 見張りから渡された1件を通知する。対象外（救急支援・解除済み・古い）は sent=false */
export async function notifyFireIncident(inc: FireIncidentLite): Promise<{ sent: boolean; recipients: number }> {
  const hit = classifyFireIncident(inc)
  if (!hit) return { sent: false, recipients: 0 }
  const r = await send('fire', hit.dedupeKey, hit.title, hit.body, 24 * 60)
  return { sent: r.recipients > 0, recipients: r.recipients }
}

/** 公開されている fire-incidents.json を読み、新しい消防情報を希望した会員へ通知する（重複は incident id で防ぐ） */
export async function notifyFireIncidents(fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl(`${FIRE_INCIDENTS_URL}?t=${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`fire-incidents.json HTTP ${res.status}`)
  const data = (await res.json()) as { incidents?: FireIncidentLite[] }
  let sent = 0
  for (const inc of data.incidents ?? []) {
    const hit = classifyFireIncident(inc)
    if (!hit) continue
    const r = await send('fire', hit.dedupeKey, hit.title, hit.body, 24 * 60)
    if (r.recipients > 0) sent += 1
  }
  return sent
}
