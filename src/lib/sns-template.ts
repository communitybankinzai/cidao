// SNS 投稿テンプレ生成
// 媒体ごとの文字数制約・タグ習慣を踏まえてターゲット種別ごとに本文を組み立てる。
// X: 280字推奨（日本語約140）
// Facebook: 制約緩い
// LINE: メッセージ通常テキスト（リンク自動展開あり）

const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'
const BOARD_URL = `${SITE_BASE}/freefree`

export type SnsTarget = {
  target_type: 'freefree' | 'event' | 'org' | 'proposal'
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
}

export type SnsMedium = 'x' | 'facebook' | 'line' | 'threads' | 'instagram'

const FREEFREE_HASHTAGS = ['#印西市', '#FreeFree', '#印西応援']
const EVENT_HASHTAGS = ['#印西市', '#イベント情報']
const ORG_HASHTAGS = ['#印西市', '#市民活動']
const PROPOSAL_HASHTAGS = ['#印西市', '#CiDAO']

function url(target: SnsTarget, medium?: SnsMedium): string {
  switch (target.target_type) {
    case 'freefree': return `${SITE_BASE}/freefree/${target.target_id}`
    case 'event':    return `${SITE_BASE}/events/${target.target_id}`
    case 'org':      return `${SITE_BASE}/orgs/${target.target_id}`
    case 'proposal':
      // 提案告知は SNS からの流入を媒体別に測りたいので UTM を付ける
      return `${SITE_BASE}/proposals/${target.target_id}?utm_source=${medium ?? 'sns'}&utm_medium=social&utm_campaign=proposal_announce`
  }
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
    case 'craft':     return '【印西応援🛠】'
    case 'living':    return '【印西応援🏠】'
    case 'startup':   return '【印西応援💼】'
    case 'event':     return '【印西応援🌟】'
    case 'volunteer': return '【印西応援🤝】'
    default:          return '【印西応援】'
  }
}

export function generateSnsContent(target: SnsTarget, medium: SnsMedium): string {
  const link = url(target, medium)
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
      const when = target.start_at ? new Date(target.start_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
      const loc = target.location ? ` @ ${target.location}` : ''
      body = `${target.title}${loc}\n${when}${target.organizer_name ? ` / ${target.organizer_name}` : ''}\n${truncate(target.body ?? '', 80)}`
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
      return `${prefix}\n${freefreeEndorsement(target.poster_name, 20)}\n\n${truncate(target.title, 30)}${loc}\n${link}\n${tagLine}`
    }
    const compact = `${prefix} ${truncate(target.title, 50)}\n${truncate(body.replace(target.title, '').replace(/\n+/g, ' '), 80)}\n${link}\n${tagLine}`
    return compact
  }

  // Facebook / LINE / Threads / Instagram は字数に余裕があるため、導線も添える
  // （Threads は500字・Instagram キャプションは2200字まで。下記は十分収まる）
  if (target.target_type === 'freefree') {
    return `${prefix}\n${body}\n\n▶ くわしくはこちら\n${link}\n\n印西で活動する人を、市民の手で応援する掲示板です。掲載は無料です。\n${BOARD_URL}\n${tagLine}`
  }
  if (target.target_type === 'proposal') {
    return `${prefix}\n${body}\n\n▶ 提案の全文と議論はこちら\n${link}\n\n意見・投票への参加には CiDAO（印西の市民DAO）への登録が必要です。登録は無料です。\n${tagLine}`
  }
  return `${prefix}\n${body}\n\n▶ ${link}\n${tagLine}`
}
