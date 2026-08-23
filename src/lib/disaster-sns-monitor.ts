import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSnsCredentials } from '@/lib/sns-dispatch'

export type MonitorPlatform = 'threads' | 'instagram' | 'bluesky'

type MonitorRule = {
  id: string
  platform: MonitorPlatform
  query: string
  last_scanned_at: string | null
}

export type MonitorItem = {
  platform: MonitorPlatform
  externalId: string
  permalink: string
  username: string
  text: string
  commentsText: string
  mediaUrl: string
  timestamp: string
  locationName: string
  lat: number | null
  lng: number | null
  query: string
  raw: Record<string, unknown>
}

type RuleResult = {
  ruleId: string
  platform: MonitorPlatform
  query: string
  status: 'success' | 'skipped' | 'failed'
  fetched: number
  matched: number
  inserted: number
  message?: string
}

type MonitorCredentials = Awaited<ReturnType<typeof loadSnsCredentials>> & {
  instagramDiscovery: { user_id: string; access_token: string } | null
  blueskyAccessToken: string | null
  blueskyAuthError: string | null
}

// 印西市の地名辞書（日本郵便の郵便番号データ由来の全68町域を2026-08-22に取得）。
// 全国に同名が多い語（大森=東京都大田区、小林=人名/宮崎県 等）を単独で拾うと
// 市外の投稿を大量に取り込むため、2段構えにしている。
// STRONG: 単独で印西市内と判断してよい固有性の高い地名
// WEAK  : 「印西」「千葉ニュータウン」等の併記があるときだけ場所語として扱う
const LOCATION_CORE = /印西|千葉ニュータウン|千葉NT|印旛|本埜|北総線/
const LOCATION_STRONG = /つくりや台|吉高|多々羅田|宗甫|小林北|小林大門下|小林浅間|岩戸|師戸|平賀|平賀学園台|戸神台|木下|木下南|木下東|木刈|松虫|武西学園台|浦幡新田|浦部|浦部村新田|牧の原|牧の木戸|発作|結縁寺|若萩|草深|萩原|西の原|鎌苅|高花|高西新田|鹿黒|鹿黒南|六軒/
const LOCATION_WEAK = /中央北|中央南|亀成|内野|別所|原|原山|吉田|和泉|大塚|大廻|大森|小倉|小倉台|小林|山田|平岡|戸神|東の原|松崎|松崎台|武西|泉|泉野|浅間前|瀬戸|牧の台|白幡|相嶋|竹袋|美瀬|舞姫|船尾|造谷/

function hasLocationSignal(text: string): boolean {
  if (LOCATION_CORE.test(text) || LOCATION_STRONG.test(text)) return true
  // あいまい地名は市名等の併記が必要（例:「大森」だけでは東京都大田区と区別できない）
  return LOCATION_WEAK.test(text) && LOCATION_CORE.test(text)
}
const DISASTER_SIGNAL = /冠水|浸水|洪水|氾濫|越水|大雨|豪雨|線状降水帯|通行止|通れな|通行でき|道路.{0,8}水|アンダーパス|土砂|土石流|崖崩|がけ崩|倒木|停電|断水|救助|取り残|避難|地震|揺れ|震度|倒壊|液状化|警報|注意報|河川.{0,8}(増水|危険)|水没|水浸し|冠水注意|池のよう|川のよう|濁り水|信号.{0,4}(消え|停止)|電柱.{0,4}(倒|折)|屋根.{0,6}(飛|剥が|壊)|瓦.{0,4}(飛|落)|看板.{0,4}(倒|飛)|土のう|土嚢/
const LOOKBACK_MS = 6 * 60 * 60 * 1000
const MAX_INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function safeHttpsUrl(value: unknown): string {
  const url = stringValue(value)
  return /^https:\/\//i.test(url) ? url : ''
}

function numberValue(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// プラットフォーム別の最短巡回間隔。cron は5分ごとだが、Instagram Graph API は
// アプリ単位の時間あたり呼出上限（エラー #4 "Application request limit reached"）が厳しく、
// 4語×5分の巡回で 2026-08-23 に上限へ達したため 20 分に間引く（ルールの last_scanned_at 基準）。
// scanSince は前回時刻の5分前から検索するため、間引いても取りこぼしは出ない。
const PLATFORM_MIN_INTERVAL_MS: Partial<Record<MonitorPlatform, number>> = {
  instagram: 20 * 60 * 1000,
}

function shouldSkipForInterval(rule: MonitorRule, now: Date): boolean {
  const interval = PLATFORM_MIN_INTERVAL_MS[rule.platform]
  if (!interval || !rule.last_scanned_at) return false
  const previous = new Date(rule.last_scanned_at).getTime()
  return Number.isFinite(previous) && now.getTime() - previous < interval
}

function scanSince(lastScannedAt: string | null): Date {
  const now = Date.now()
  const previous = lastScannedAt ? new Date(lastScannedAt).getTime() : Number.NaN
  if (!Number.isFinite(previous)) return new Date(now - MAX_INITIAL_LOOKBACK_MS)
  return new Date(Math.max(previous - 5 * 60 * 1000, now - LOOKBACK_MS))
}

// 災害時に優先して確認すべき公式・準公式アカウント。
// キーワード検索で拾えた投稿のうち、これらの発信を「重要」として先頭に出す。
// Instagramのハッシュタグ検索は username を返さないため、本文の署名や
// permalink から判定する（business_discovery API は App Review 未取得のため使えない）。
const PRIORITY_ACCOUNTS: Array<{ handle: string; label: string; textHints: RegExp }> = [
  {
    handle: 'fujishiro.kengo',
    label: '印西市長',
    // 市長投稿は「印西市長」「市長の藤代」等の署名や、市の対応報告の言い回しを含む
    textHints: /印西市長|市長の藤代|藤代健吾|一部職員の皆さんにご参集|市内の見回り/,
  },
  {
    handle: 'inzai_city',
    label: '印西市公式',
    textHints: /印西市役所|印西市.{0,6}(公式|防災課|災害対策本部)/,
  },
]

// permalink（https://www.instagram.com/<user>/p/xxx/ 等）からユーザー名を復元する。
// ハッシュタグ検索の media では username が返らないため、これが唯一の手掛かりになる。
function usernameFromPermalink(permalink: string): string {
  const m = String(permalink || '').match(/^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|tv)\//)
  return m ? m[1] : ''
}

// 重要アカウント判定。一致すればラベル（例「印西市長」）を返す
export function priorityLabelOf(item: MonitorItem): string {
  const handle = (item.username || usernameFromPermalink(item.permalink)).toLowerCase()
  for (const account of PRIORITY_ACCOUNTS) {
    if (handle && handle === account.handle.toLowerCase()) return account.label
    if (account.textHints.test(item.text)) return account.label
  }
  return ''
}

function matchesScope(item: MonitorItem): boolean {
  const searchable = `${item.text}\n${item.commentsText}\n${item.locationName}`
  return (hasLocationSignal(searchable) || hasLocationSignal(item.query))
    && (DISASTER_SIGNAL.test(searchable) || DISASTER_SIGNAL.test(item.query))
}

function itemWithinRange(item: MonitorItem, since: Date, until: Date): boolean {
  const postedAt = new Date(item.timestamp).getTime()
  return Number.isFinite(postedAt) && postedAt >= since.getTime() && postedAt <= until.getTime()
}

function blueskyPermalink(uri: string, handle: string): string {
  const rkey = uri.split('/').pop() ?? ''
  return handle && rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}` : ''
}

// SNS側の障害・ブロック時はJSONでなくHTMLエラーページが返ることがある。
// パース前にHTTPステータスを確認しないと「Unexpected token '<'」しか記録されず
// 原因調査ができないため、応答は必ずこの関数を通す。
function parseJsonText(text: string): Record<string, unknown> | null {
  try {
    const parsed = text ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

const BLUESKY_PDS = 'https://bsky.social'
const BLUESKY_AUTH_KEY = 'sns_bluesky_search_auth'
const BLUESKY_SESSION_KEY = 'sns_bluesky_search_session'
// accessJwtは約2時間で失効する。余裕をみて60分でrefreshする
const BLUESKY_SESSION_TTL_MS = 60 * 60 * 1000

type BlueskySessionValue = {
  access_jwt?: string
  refresh_jwt?: string
  handle?: string
  saved_at?: string
}

async function fetchBlueskyJson(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const text = await response.text()
  const payload = parseJsonText(text)
  if (!response.ok || !payload) {
    const detail = payload
      ? JSON.stringify((payload as { error?: unknown; message?: unknown }).message ?? payload).slice(0, 240)
      : `非JSON応答: ${text.slice(0, 240) || '本文なし'}`
    throw new Error(`${label} ${response.status}: ${detail}`)
  }
  return payload
}

// Bluesky検索用のaccessJwtを用意する。認証未設定ならnull。
// createSessionはアカウントあたり約300回/日の制限があるため、
// セッションをapp_settingsへキャッシュし、期限が近づいたらrefreshSessionで延命する。
async function ensureBlueskyAccessToken(supabase: SupabaseClient): Promise<string | null> {
  const [{ data: authRow }, { data: sessionRow }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', BLUESKY_AUTH_KEY).maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', BLUESKY_SESSION_KEY).maybeSingle(),
  ])
  const auth = authRow?.value as { identifier?: string; app_password?: string } | null
  if (!auth?.identifier || !auth?.app_password) return null

  const session = sessionRow?.value as BlueskySessionValue | null
  const savedAt = session?.saved_at ? new Date(session.saved_at).getTime() : Number.NaN
  if (session?.access_jwt && Number.isFinite(savedAt) && Date.now() - savedAt < BLUESKY_SESSION_TTL_MS) {
    return session.access_jwt
  }

  let payload: Record<string, unknown> | null = null
  if (session?.refresh_jwt) {
    payload = await fetchBlueskyJson(`${BLUESKY_PDS}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.refresh_jwt}` },
    }, 'Bluesky refreshSession').catch(() => null)
  }
  if (!payload) {
    payload = await fetchBlueskyJson(`${BLUESKY_PDS}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: auth.identifier, password: auth.app_password }),
    }, 'Bluesky createSession').catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Bluesky認証に失敗しました（App Passwordを確認してください）: ${message}`)
    })
  }
  const accessJwt = stringValue(payload.accessJwt)
  if (!accessJwt) throw new Error('Blueskyセッションの取得に失敗しました（App Passwordを確認してください）')
  await supabase.from('app_settings').upsert({
    key: BLUESKY_SESSION_KEY,
    value: {
      access_jwt: accessJwt,
      refresh_jwt: stringValue(payload.refreshJwt),
      handle: stringValue(payload.handle),
      saved_at: new Date().toISOString(),
    } satisfies BlueskySessionValue,
    updated_at: new Date().toISOString(),
  })
  return accessJwt
}

async function searchBluesky(
  rule: MonitorRule,
  accessToken: string | null,
  since: Date,
  until: Date,
): Promise<MonitorItem[]> {
  const params = new URLSearchParams({
    q: rule.query,
    sort: 'latest',
    limit: '50',
    since: since.toISOString(),
    until: until.toISOString(),
  })
  // 2026-08からapi.bsky.appの未認証searchPostsは403（HTML応答）で拒否される。
  // 認証設定時はPDS（bsky.social）経由でAppViewへプロキシ検索する。
  const endpoint = accessToken
    ? `${BLUESKY_PDS}/xrpc/app.bsky.feed.searchPosts?${params}`
    : `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params}`
  let payload: Record<string, unknown>
  try {
    payload = await fetchBlueskyJson(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    }, 'Bluesky')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!accessToken) {
      throw new Error(`${message}（未認証のBluesky検索は拒否されるようになりました。/admin/sns のSNS接続設定でBluesky検索用認証を登録してください）`)
    }
    throw error
  }
  const posts = Array.isArray(payload.posts) ? payload.posts : []
  return posts.map((raw: unknown) => {
    const post = asObject(raw)
    const author = asObject(post.author)
    const record = asObject(post.record)
    const embed = asObject(post.embed)
    const images = Array.isArray(embed.images) ? embed.images : []
    const image = asObject(images[0])
    const uri = stringValue(post.uri)
    const handle = stringValue(author.handle)
    return {
      platform: 'bluesky' as const,
      externalId: uri || stringValue(post.cid),
      permalink: blueskyPermalink(uri, handle),
      username: handle,
      text: stringValue(record.text),
      commentsText: '',
      mediaUrl: safeHttpsUrl(image.fullsize) || safeHttpsUrl(image.thumb),
      timestamp: stringValue(record.createdAt) || stringValue(post.indexedAt),
      locationName: '',
      lat: null,
      lng: null,
      query: rule.query,
      raw: post,
    }
  }).filter((item: MonitorItem) => item.externalId && item.permalink)
}

async function searchThreads(
  rule: MonitorRule,
  token: string,
  since: Date,
  until: Date,
): Promise<MonitorItem[]> {
  const params = new URLSearchParams({
    q: rule.query.replace(/^#/, ''),
    search_type: 'RECENT',
    search_mode: rule.query.startsWith('#') ? 'TAG' : 'KEYWORD',
    fields: 'id,text,media_type,media_url,permalink,timestamp,username',
    limit: '50',
    since: since.toISOString(),
    until: until.toISOString(),
    access_token: token,
  })
  const response = await fetch(`https://graph.threads.net/keyword_search?${params}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const responseText = await response.text()
  const parsed = parseJsonText(responseText)
  const payload = parsed ?? {}
  if (!response.ok) {
    const detail = responseText
      ? parsed
        ? JSON.stringify((parsed as { error?: unknown }).error ?? parsed).slice(0, 240)
        : `非JSON応答: ${responseText.slice(0, 240)}`
      : '応答本文なし。threads_keyword_search権限を含むトークンで再認証してください'
    throw new Error(`Threads ${response.status}: ${detail}`)
  }
  const data = Array.isArray(payload.data) ? payload.data : []
  return data.map((raw: unknown) => {
    const post = asObject(raw)
    return {
      platform: 'threads' as const,
      externalId: stringValue(post.id),
      permalink: safeHttpsUrl(post.permalink),
      username: stringValue(post.username),
      text: stringValue(post.text),
      commentsText: '',
      mediaUrl: safeHttpsUrl(post.media_url),
      timestamp: stringValue(post.timestamp),
      locationName: '',
      lat: numberValue(post.latitude),
      lng: numberValue(post.longitude),
      query: rule.query,
      raw: post,
    }
  }).filter((item: MonitorItem) => item.externalId && item.permalink)
}

async function searchInstagram(
  rule: MonitorRule,
  userId: string,
  token: string,
  since: Date,
  until: Date,
): Promise<MonitorItem[]> {
  const tagParams = new URLSearchParams({
    user_id: userId,
    q: rule.query.replace(/^#/, ''),
    access_token: token,
  })
  const tagResponse = await fetch(`https://graph.facebook.com/v22.0/ig_hashtag_search?${tagParams}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const tagPayload = await tagResponse.json().catch(() => ({}))
  const hashtagId = Array.isArray(tagPayload.data) ? stringValue(asObject(tagPayload.data[0]).id) : ''
  if (!tagResponse.ok || !hashtagId) {
    const detail = JSON.stringify(tagPayload?.error ?? tagPayload).slice(0, 240)
    // IGのハッシュタグ検索は完全一致のみ。投稿が1件もないタグは「存在しない」エラーで返るため候補0件として扱う
    if (/does not exist/i.test(detail)) return []
    throw new Error(`Instagram hashtag ${tagResponse.status}: ${detail}`)
  }

  const fetchMedia = async (limit: number) => {
    const mediaParams = new URLSearchParams({
      user_id: userId,
      // ハッシュタグ経由の media では username は取得不可（#100 unsupported fields になる）
      fields: 'id,caption,media_type,media_url,permalink,timestamp',
      limit: String(limit),
      access_token: token,
    })
    const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(hashtagId)}/recent_media?${mediaParams}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  }

  // 人気タグはlimitが大きいと code:1「Please reduce the amount of data」で500になるため、控えめに取得し、それでも出たらさらに絞って1回だけ再試行
  let { response, payload } = await fetchMedia(25)
  if (!response.ok && /reduce the amount of data/i.test(stringValue(asObject(payload?.error).message))) {
    ;({ response, payload } = await fetchMedia(10))
  }
  if (!response.ok) throw new Error(`Instagram media ${response.status}: ${JSON.stringify(payload?.error ?? payload).slice(0, 240)}`)
  const data = Array.isArray(payload.data) ? payload.data : []
  return data.map((raw: unknown) => {
    const post = asObject(raw)
    return {
      platform: 'instagram' as const,
      externalId: stringValue(post.id),
      permalink: safeHttpsUrl(post.permalink),
      username: stringValue(post.username),
      text: stringValue(post.caption),
      commentsText: '',
      mediaUrl: safeHttpsUrl(post.media_url),
      timestamp: stringValue(post.timestamp),
      locationName: '',
      lat: null,
      lng: null,
      query: rule.query,
      raw: post,
    }
  }).filter((item: MonitorItem) => item.externalId && item.permalink && itemWithinRange(item, since, until))
}

async function searchRule(
  rule: MonitorRule,
  credentials: MonitorCredentials,
  since: Date,
  until: Date,
): Promise<MonitorItem[]> {
  if (rule.platform === 'bluesky') {
    if (credentials.blueskyAuthError) throw new Error(credentials.blueskyAuthError)
    return searchBluesky(rule, credentials.blueskyAccessToken, since, until)
  }
  if (rule.platform === 'threads') {
    if (!credentials.threads?.access_token) throw new Error('Threadsアクセストークン未設定')
    return searchThreads(rule, credentials.threads.access_token, since, until)
  }
  if (!credentials.instagramDiscovery?.access_token || !credentials.instagramDiscovery.user_id) {
    throw new Error('Instagram検索用認証未設定（Facebook Login方式のハッシュタグ検索権限が必要）')
  }
  return searchInstagram(rule, credentials.instagramDiscovery.user_id, credentials.instagramDiscovery.access_token, since, until)
}

async function saveCandidates(
  supabase: SupabaseClient,
  rule: MonitorRule,
  items: MonitorItem[],
): Promise<number> {
  if (items.length === 0) return 0
  const rows = items.map((item) => ({
    platform: item.platform,
    external_id: item.externalId,
    permalink: item.permalink,
    // ハッシュタグ検索は username を返さないため permalink から補完する
    author_username: item.username || usernameFromPermalink(item.permalink) || null,
    body_text: item.text,
    comments_text: item.commentsText,
    media_url: item.mediaUrl || null,
    posted_at: item.timestamp,
    matched_rule_id: rule.id,
    matched_query: rule.query,
    latitude: item.lat,
    longitude: item.lng,
    location_name: item.locationName || null,
    // 重要アカウント（市長・市公式）の投稿は画面で先頭に出せるよう印を付ける
    raw_payload: { ...item.raw, priority_label: priorityLabelOf(item) || undefined },
  }))
  const { data, error } = await supabase
    .from('disaster_sns_candidates')
    .upsert(rows, { onConflict: 'platform,external_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

export async function runDisasterSnsMonitor(supabase: SupabaseClient) {
  const { data: claimed, error: claimError } = await supabase.rpc('claim_disaster_sns_scan', {
    p_min_interval_seconds: 240,
  })
  if (claimError) throw claimError
  if (!claimed) return { skipped: true, discovered: 0, results: [] as RuleResult[] }

  const startedAt = new Date().toISOString()
  const { data: run, error: runError } = await supabase
    .from('disaster_sns_scan_runs')
    .insert({ started_at: startedAt, status: 'running' })
    .select('id')
    .single()
  if (runError) throw runError

  const { data: rules, error: rulesError } = await supabase
    .from('disaster_sns_monitor_rules')
    .select('id, platform, query, last_scanned_at')
    .eq('enabled', true)
    .order('platform')
    .order('query')
  if (rulesError) throw rulesError

  const [baseCredentials, { data: instagramDiscoveryRow }, { data: threadsDiscoveryRow }] = await Promise.all([
    loadSnsCredentials(supabase),
    supabase.from('app_settings').select('value').eq('key', 'sns_instagram_discovery_auth').maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', 'sns_threads_discovery_auth').maybeSingle(),
  ])
  const discoveryValue = instagramDiscoveryRow?.value as { user_id?: string; access_token?: string } | null
  // Threads の公開投稿検索は検索専用アプリのトークンを優先する。
  // 投稿用アプリはダッシュボードのフォーム破損で threads_keyword_search を付与できないため、
  // 検索は別アプリで認証する構成（2026-08-17）。未設定時は従来どおり投稿用トークンで試す。
  const threadsDiscoveryValue = threadsDiscoveryRow?.value as { access_token?: string } | null

  // Blueskyの検索は認証必須になったため、ルールがあるときだけセッションを用意する。
  // 認証エラーはここでは投げず、各ルールの結果（last_error）として記録する。
  let blueskyAccessToken: string | null = null
  let blueskyAuthError: string | null = null
  if ((rules ?? []).some((rule) => (rule as MonitorRule).platform === 'bluesky')) {
    try {
      blueskyAccessToken = await ensureBlueskyAccessToken(supabase)
    } catch (error) {
      blueskyAuthError = error instanceof Error ? error.message : String(error)
    }
  }

  const credentials: MonitorCredentials = {
    ...baseCredentials,
    ...(threadsDiscoveryValue?.access_token
      ? { threads: { ...(baseCredentials.threads ?? {}), access_token: String(threadsDiscoveryValue.access_token) } as MonitorCredentials['threads'] }
      : {}),
    instagramDiscovery: discoveryValue?.user_id && discoveryValue?.access_token
      ? { user_id: String(discoveryValue.user_id), access_token: String(discoveryValue.access_token) }
      : null,
    blueskyAccessToken,
    blueskyAuthError,
  }
  const until = new Date()
  const results: RuleResult[] = []
  let discovered = 0

  for (const rawRule of rules ?? []) {
    const rule = rawRule as MonitorRule
    if (shouldSkipForInterval(rule, until)) {
      results.push({ ruleId: rule.id, platform: rule.platform, query: rule.query, status: 'skipped', fetched: 0, matched: 0, inserted: 0, message: '巡回間隔の間引き（Instagramは20分ごと）' })
      continue
    }
    const since = scanSince(rule.last_scanned_at)
    try {
      const fetchedItems = await searchRule(rule, credentials, since, until)
      const matchedItems = fetchedItems.filter((item) => itemWithinRange(item, since, until) && matchesScope(item))
      const inserted = await saveCandidates(supabase, rule, matchedItems)
      discovered += inserted
      results.push({
        ruleId: rule.id,
        platform: rule.platform,
        query: rule.query,
        status: 'success',
        fetched: fetchedItems.length,
        matched: matchedItems.length,
        inserted,
      })
      await supabase.from('disaster_sns_monitor_rules').update({
        last_scanned_at: until.toISOString(),
        last_status: 'success',
        last_error: null,
        updated_at: until.toISOString(),
      }).eq('id', rule.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // キャッシュ済みaccessJwtが失効・無効化されていた場合は破棄し、次回巡回で再ログインさせる
      if (rule.platform === 'bluesky' && /^Bluesky 401/.test(message)) {
        await supabase.from('app_settings').delete().eq('key', BLUESKY_SESSION_KEY)
      }
      results.push({
        ruleId: rule.id,
        platform: rule.platform,
        query: rule.query,
        status: 'failed',
        fetched: 0,
        matched: 0,
        inserted: 0,
        message,
      })
      await supabase.from('disaster_sns_monitor_rules').update({
        last_scanned_at: until.toISOString(),
        last_status: 'failed',
        last_error: message.slice(0, 500),
        updated_at: until.toISOString(),
      }).eq('id', rule.id)
    }
  }

  const failed = results.filter((result) => result.status === 'failed').length
  const status = failed === 0 ? 'success' : failed === results.length ? 'failed' : 'partial'
  await supabase.from('disaster_sns_scan_runs').update({
    finished_at: new Date().toISOString(),
    status,
    discovered_count: discovered,
    result: { results },
    error_message: failed ? `${failed}件の巡回ルールで取得失敗` : null,
  }).eq('id', run.id)

  return { skipped: false, discovered, status, results }
}
