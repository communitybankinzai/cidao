// SNS 投稿テンプレ生成
// 媒体ごとの文字数制約・タグ習慣を踏まえてターゲット種別ごとに本文を組み立てる。
// X: 280字推奨（日本語約140）
// Facebook: 制約緩い
// LINE: メッセージ通常テキスト（リンク自動展開あり）

import { daysBetweenYmd, jstToday } from '@/lib/freefree-dates'
import { FOR_SHOPS_PATH, areaLabelFromLocation, gsiCreditLine, introOfBody } from '@/lib/freefree-import-core'

const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'

export type SnsTarget = {
  target_type: 'freefree' | 'event' | 'org' | 'proposal' | 'gourmet'
  target_id: string
  // 以下は呼び出し側で DB から取得した上で渡す
  title: string
  body?: string | null      // freefree.body / event.description / org.description / proposal.body
  category?: string | null
  location?: string | null
  organizer_name?: string | null
  start_at?: string | null  // event 用
  // freefree 用。団体掲載のときだけ団体名が入る。
  // 個人・個人事業の掲載者名は掲示板の詳細ページでも公開していないため、
  // SNS で新たに氏名を露出させないよう、ここには入れない（null のまま）。
  poster_name?: string | null
  // proposal 用。議論・投票の締切（表示用）
  deadline?: string | null
  // freefree 用。カウントダウンに使う日本時間の日付（YYYY-MM-DD）。
  // event_start_date＝開催日（初日・任意）、end_date＝掲載終了日（イベントなら開催最終日）
  event_start_date?: string | null
  end_date?: string | null
  // freefree 用。運営が作った掲載（公開データ由来／手で追加）のとき入る。お店の方への呼びかけの文面になる
  import_source?: 'openpoi' | 'manual' | null
  // 画像カードに地図が入るか（入るなら国土地理院の出典を投稿文に添える）
  has_map?: boolean
  // gourmet（食レポマップ・2026-11-12）用。title＝店名、body＝ひとこと。
  // gourmet_handle は「自分の投稿」かつ「CBIのSNSで紹介してよい」に同意したときだけ入る（@で呼ぶ）。
  // 他人の投稿を紹介した食レポでは、紹介した人の同意は投稿者本人の同意ではないので入れない
  gourmet_handle?: string | null
  gourmet_platform?: string | null   // 'Instagram' などの表示名
  gourmet_post_url?: string | null   // 元の投稿
  gourmet_shop_ref?: string | null   // 地図でお店を直接開く ?shop= の値
  gourmet_is_own?: boolean
}

// 食レポマップ（CBI サイト・GitHub Pages）。CiDAO ではないので utm は付けない（ルール15は CiDAO のリンクが対象）
// URL は画面側からも読めるよう cbi-site-urls.ts に置いた（2026-11-13）
export { GOURMET_MAP_URL } from '@/lib/cbi-site-urls'
import { GOURMET_MAP_URL } from '@/lib/cbi-site-urls'
export function gourmetShopUrl(ref?: string | null): string {
  return ref ? `${GOURMET_MAP_URL}?shop=${encodeURIComponent(ref)}` : GOURMET_MAP_URL
}

export type SnsMedium = 'x' | 'facebook' | 'line' | 'threads' | 'instagram'

const FREEFREE_HASHTAGS = ['#印西市', '#FreeFree', '#印西応援']
const EVENT_HASHTAGS = ['#印西市', '#イベント情報']
const ORG_HASHTAGS = ['#印西市', '#市民活動']
const PROPOSAL_HASHTAGS = ['#印西市', '#CiDAO']

// SNS に載せる CiDAO のリンクには媒体別の UTM を付ける（2026-11-07・事業主指示「改善提案実施」）。
// 閲覧は /admin/analytics の「SNS流入元別」（PageViewTracker → page_views.source）、
// 新規登録は members.signup_source（PageViewTracker・/login が Cookie に覚え、初回ログインで auth/callback が書く）で数える。
// utm の各値は signup-source.ts の PART（英数字・-_・20文字まで）に収めること。
// utm_medium は付けない（Threads の500字に収めるため。signup_source は「媒体:告知の種類」の2つ組になる）
export function withUtm(path: string, medium: SnsMedium | undefined, campaign: string): string {
  return `${SITE_BASE}${path}?utm_source=${medium ?? 'sns'}&utm_campaign=${campaign}`
}

function url(target: SnsTarget, medium?: SnsMedium): string {
  switch (target.target_type) {
    case 'freefree': return withUtm(`/freefree/${target.target_id}`, medium, 'freefree_announce')
    case 'event':    return withUtm(`/events/${target.target_id}`, medium, 'event_announce')
    case 'org':      return withUtm(`/orgs/${target.target_id}`, medium, 'org_announce')
    case 'proposal': return withUtm(`/proposals/${target.target_id}`, medium, 'proposal_announce')
    case 'gourmet':  return gourmetShopUrl(target.gourmet_shop_ref)
  }
}

// 食レポの紹介文（2026-11-12・事業主決定「通知＋同意つきだけ承認制で紹介」）。
// 元の投稿へ人を送り、投稿した人のフォロワーが増えるようにするのが狙い。写真は転載しない（カード画像は自前）
function generateGourmetSnsContent(target: SnsTarget, medium: SnsMedium): string {
  const shop = truncate(target.title, 40)
  const platform = target.gourmet_platform || 'SNS'
  const handle = target.gourmet_handle ? `@${target.gourmet_handle.replace(/^@/, '')}` : ''
  const who = handle ? `${handle} さんの${platform}の投稿` : `${platform}の投稿${target.gourmet_is_own ? '' : '（見つけた人が紹介）'}`
  const comment = target.body ? `「${truncate(target.body, 100)}」\n` : ''
  const prefix = '【印西 食レポマップ🍽】新しい食レポが届きました'
  const ask = '食べた投稿のURL、あなたも地図に貼ってみませんか（ログイン不要）。'
  const tags = '#印西市 #印西グルメ #食レポ'
  if (medium === 'x') {
    return `${prefix}\n${shop}\n${who}\n${target.gourmet_post_url ?? ''}\n${url(target, medium)}\n${tags}`
  }
  // Instagram はキャプション内の URL を押せないので、検索の言葉で地図へ誘う
  if (medium === 'instagram') {
    return `${prefix}\n\n${shop}\n${comment}📱 ${who}\n\nくわしくは元の投稿へ。地図は「印西 食レポマップ」で検索。\n${ask}\n\n${tags} #印西 #印西ランチ #CommunityBankInzai`
  }
  return `${prefix}\n\n${shop}\n${comment}📱 ${who}\n${target.gourmet_post_url ?? ''}\n\n▶ 地図でお店を見る\n${url(target, medium)}\n\n${ask}\n${tags}`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

// 「CBIが応援している」ことを本文で明言する一文。
// 団体名が判っているときだけ名指しで応援し、判らないときは活動そのものを主語にする。
function freefreeEndorsement(posterName?: string | null, maxName = 40): string {
  const name = posterName?.trim()
  if (!name) return 'CBIは、印西で続けられているこの活動を応援しています。'
  const honorific = /(さん|様|さま)$/.test(name) ? '' : 'さん'
  return `CBIは、${truncate(name, maxName)}${honorific}の地域での活動を応援しています。`
}

function freefreePrefix(category?: string | null): string {
  switch (category) {
    case 'food':      return '【印西応援🍰】'
    case 'retail':    return '【印西応援🛍】'
    case 'education': return '【印西応援🎓】'
    case 'lessons':   return '【印西応援🩰】'
    case 'craft':     return '【印西応援🛠】'
    case 'living':    return '【印西応援🏠】'
    case 'startup':   return '【印西応援💼】'
    case 'event':     return '【印西応援🌟】'
    case 'volunteer': return '【印西応援🤝】'
    default:          return '【印西応援】'
  }
}

// YYYY-MM-DD → 「11/3」
function md(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${Number(m)}/${Number(d)}`
}

// FreeFree 告知の冒頭に置くカウントダウン（2026-09-15）。
// 定期告知で毎回同じ文面にならないよう、配信する日を基準に毎回作る。
// イベントは開催日（初日）まで、開催日の入力が無いイベントは開催最終日まで、
// それ以外（お店・教室など）は掲載終了日まで数える。数えられないとき（過ぎた等）は null
export function freefreeCountdown(target: SnsTarget, today: string): string | null {
  const start = target.event_start_date ?? null
  const end = target.end_date ?? null
  if (start) {
    const n = daysBetweenYmd(today, start)
    if (n > 1) return `⏳ 開催まであと${n}日！（${md(start)}）`
    if (n === 1) return `⏰ いよいよ明日開催！（${md(start)}）`
    if (n === 0) return end && end > start ? `🎉 本日開催！（${md(end)}まで）` : '🎉 本日開催！'
    if (end && today <= end) return `🎉 開催中！（${md(end)}まで）`
    return null
  }
  if (!end) return null
  const n = daysBetweenYmd(today, end)
  if (target.category === 'event') {
    if (n > 1) return `⏳ ${md(end)}まで、あと${n}日！`
    if (n === 1) return `⏰ いよいよ明日（${md(end)}）まで！`
    if (n === 0) return `🎉 本日（${md(end)}）まで！`
    return null
  }
  if (n > 1) return `⏳ 掲載終了まであと${n}日（${md(end)}まで）`
  if (n === 1) return '⏰ 掲載は明日まで'
  if (n === 0) return '⏰ 掲載は本日まで'
  return null
}

// now は「配信する時点」。カウントダウンの基準日になる（テストでは固定値を渡す）
/**
 * 運営が作った掲載（公開データ由来・手で追加）の告知文。
 * お店の方に気づいてもらい、CiDAO に登録して写真とPR文を自分で登録してもらうのが目的。
 * 「CBIが応援している」とは書かない（お店は頼んでいない）。カウントダウンも付けない。
 * 口コミ・評価は書かない。店名のタグ付けもしない。地図の画像を使うので国土地理院の出典を添える。
 */
export function generateImportSnsContent(target: SnsTarget, medium: SnsMedium): string {
  const link = url(target, medium)
  const forShops = withUtm(FOR_SHOPS_PATH, medium, 'freefree_forshops')
  const area = areaLabelFromLocation(target.location)
  const name = `${truncate(target.title, 40)}${area ? `（${area}）` : ''}`
  const intro = introOfBody(target.body)
  const credit = target.has_map ? `\n${gsiCreditLine()}` : ''
  const prefix = '【印西のお店・施設📍】'
  const ask = 'お店の方へ：写真・PR文・クーポンを、ご自身で載せられます。CiDAOに登録（無料）してください。'
  const made = '公開データをもとに、運営が掲載ページを作りました。'

  if (medium === 'x') {
    return `${prefix}\n${truncate(target.title, 30)}${area ? `（${area}）` : ''}\n${truncate(ask, 40)}\n${link}\n#印西市 #FreeFree`
  }
  if (medium === 'instagram') {
    // Instagram はキャプション内の URL を押せないため、プロフィールのリンクへ誘導する（提案告知と同じ運用）
    return `${prefix}\n${name}${intro ? `\n${truncate(intro, 80)}` : ''}\n\n${made}\n${ask}\n\nくわしくは、プロフィールのリンクから CiDAO の「FreeFree 掲示板」へ。検索なら「CiDAO 印西」で。${credit}\n\n#印西市 #印西 #FreeFree #印西応援 #地域応援`
  }
  // 紹介文は 65 字まで（リンク2本の utm の分を含めて Threads の500字に収める・2026-11-07）
  return `${prefix}\n${name}${intro ? `\n${truncate(intro, 65)}` : ''}\n\n${made}\n${ask}\n\n▶ 掲載ページ\n${link}\n▶ お店の方へ\n${forShops}${credit}\n\n#印西市 #FreeFree #印西応援`
}

export function generateSnsContent(target: SnsTarget, medium: SnsMedium, now = Date.now()): string {
  if (target.target_type === 'freefree' && target.import_source) return generateImportSnsContent(target, medium)
  if (target.target_type === 'gourmet') return generateGourmetSnsContent(target, medium)
  const link = url(target, medium)
  // FreeFree は冒頭をカウントダウンで強調する（無ければ何も付けない）
  const countdown = target.target_type === 'freefree' ? freefreeCountdown(target, jstToday(now)) : null
  const head = countdown ? `${countdown}\n` : ''
  let prefix = ''
  let body = ''
  let hashtags: string[] = []

  switch (target.target_type) {
    case 'freefree': {
      prefix = freefreePrefix(target.category)
      const loc = target.location ? `（${target.location}）` : ''
      body = `${freefreeEndorsement(target.poster_name)}\n\n${target.title}${loc}\n${truncate(target.body ?? '', 120)}`
      hashtags = FREEFREE_HASHTAGS
      break
    }
    case 'event': {
      prefix = '【印西イベント📅】'
      // サーバーはUTCで動くため timeZone 指定必須（指定なしだと「8/15 01:00」のようにUTC時刻が出る）
      const when = target.start_at ? new Date(target.start_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
      // タイトル・場所・主催者名は自由入力。長いと Threads の500字で末尾の登録導線が切れるため上限をかける
      // 上限は、リンク2本に utm が付いた分（2026-11-07）を含めて Threads の500字に収まる値
      const loc = target.location ? ` @ ${truncate(target.location, 30)}` : ''
      body = `${truncate(target.title, 60)}${loc}\n${when}${target.organizer_name ? ` / ${truncate(target.organizer_name, 30)}` : ''}\n${truncate(target.body ?? '', 50)}`
      hashtags = EVENT_HASHTAGS
      break
    }
    case 'org': {
      prefix = '【印西の団体👥】'
      body = `${target.title}\n${truncate(target.body ?? '', 120)}`
      hashtags = ORG_HASHTAGS
      break
    }
    case 'proposal': {
      prefix = '【CiDAOに新しい提案📮】'
      const until = target.deadline
        ? `\n意見募集は ${new Date(target.deadline).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} まで。`
        : ''
      body = `${target.title}\n${truncate(target.body ?? '', 120)}${until}`
      hashtags = PROPOSAL_HASHTAGS
      break
    }
  }

  const tagLine = hashtags.join(' ')

  // 媒体別の長さ調整
  if (medium === 'x') {
    // X は 280 weighted（日本語は1字2カウント、URL は長さに関わらず23）。
    // freefree では CBI の応援表明を最優先で残し、本文抜粋と掲示板トップへの
    // 導線は落とす（掲示板へは個別ページから辿れる）。
    if (target.target_type === 'freefree') {
      // 掲載者名・タイトル・場所はいずれも利用者の自由入力なので、
      // どれが長くても 280 weighted を超えないよう個別に上限をかける。
      const loc = target.location ? `（${truncate(target.location, 20)}）` : ''
      return `${head}${prefix}\n${freefreeEndorsement(target.poster_name, 20)}\n\n${truncate(target.title, 30)}${loc}\n${link}\n${tagLine}`
    }
    const compact = `${prefix} ${truncate(target.title, 50)}\n${truncate(body.replace(target.title, '').replace(/\n+/g, ' '), 80)}\n${link}\n${tagLine}`
    return compact
  }

  // Facebook / LINE / Threads / Instagram は字数に余裕があるため、導線も添える
  // （Threads は500字・Instagram キャプションは2200字まで。下記は十分収まる）
  if (target.target_type === 'freefree') {
    // Instagram はキャプション内の URL を押せないため、プロフィールのリンクへ誘導する（提案告知と同じ運用）
    if (medium === 'instagram') {
      return `${head}${prefix}\n${body}\n\nくわしくは、プロフィールのリンクから CiDAO の「FreeFree 掲示板」へ。\n印西で活動する人を、市民の手で応援する掲示板です。掲載は無料です。\n\n#印西市 #印西 #FreeFree #印西応援 #地域応援`
    }
    return `${head}${prefix}\n${body}\n\n▶ くわしくはこちら\n${link}\n\n印西で活動する人を、市民の手で応援する掲示板です。掲載は無料です。\n${withUtm('/freefree', medium, 'freefree_board')}\n${tagLine}`
  }
  if (target.target_type === 'proposal') {
    // Instagram はキャプション内のURLがクリックできないため、URL文字列は載せず
    // プロフィールのリンク＋検索キーワードで誘導する。ハッシュタグもIGの文化に合わせて多めにする。
    // 前提運用：@communitybankinzai のプロフィールのリンク欄に CiDAO の URL を設定しておくこと
    if (medium === 'instagram') {
      return `${prefix}\n${body}\n\nこの提案への意見・投票は、プロフィールのリンクからCiDAOへ。\n検索なら「CiDAO 印西」で。登録は無料です。\n\n#印西市 #印西 #CiDAO #市民参加 #まちづくり`
    }
    return `${prefix}\n${body}\n\n▶ 提案の全文と議論はこちら\n${link}\n\n意見・投票への参加には CiDAO（印西の市民DAO）への登録が必要です。登録は無料です。\n${tagLine}`
  }
  if (target.target_type === 'event') {
    // 冒頭の定型句：通常のイベント告知は毎朝7時に「その日開催」の分をまとめて行っており（cbi-admin-gas/ThreadsDailyPost.gs・Threads）、
    // これは主催者の依頼を受けた単独での告知であることを示す（2026-10-06・事業主指示。当日朝であることはコードで確認済み）
    const lead = 'イベント告知は、毎朝、その日開催の分をまとめて行っています。主催者から依頼があった場合は、当日以外にも単独でのイベント告知に協力しています。\n\n'
    // イベント紹介の末尾に、CBIに協力してほしい団体・企業へ CiDAO 登録を促す導線を置く（2026-10-06・事業主指示）。
    // Instagram はキャプション内のURLが押せないため、プロフィールのリンクへ誘導する
    if (medium === 'instagram') {
      return `${lead}${prefix}\n${body}\n\nCBIの活動に協力してくださる印西市民の方・団体・企業の方は、プロフィールのリンクからCiDAOへご登録ください（無料）。\n\n#印西市 #イベント情報 #CiDAO #印西`
    }
    return `${lead}${prefix}\n${body}\n\n▶ ${link}\n\nCBIの活動に協力してくださる印西市民の方・団体・企業の方は、CiDAOへご登録ください（無料）\n${withUtm('/login', medium, 'event_announce')}\n${tagLine}`
  }
  return `${prefix}\n${body}\n\n▶ ${link}\n${tagLine}`
}
