// SNS 投稿テンプレ生成
// 媒体ごとの文字数制約・タグ習慣を踏まえてターゲット種別ごとに本文を組み立てる。
// X: 280字推奨（日本語約140）
// Facebook: 制約緩い
// LINE: メッセージ通常テキスト（リンク自動展開あり）

const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'

export type SnsTarget = {
  target_type: 'freefree' | 'event' | 'org'
  target_id: string
  // 以下は呼び出し側で DB から取得した上で渡す
  title: string
  body?: string | null      // freefree.body / event.description / org.description
  category?: string | null
  location?: string | null
  organizer_name?: string | null
  start_at?: string | null  // event 用
}

const FREEFREE_HASHTAGS = ['#印西市', '#FreeFree', '#印西応援']
const EVENT_HASHTAGS = ['#印西市', '#イベント情報']
const ORG_HASHTAGS = ['#印西市', '#市民活動']

function url(target: SnsTarget): string {
  switch (target.target_type) {
    case 'freefree': return `${SITE_BASE}/freefree/${target.target_id}`
    case 'event':    return `${SITE_BASE}/events/${target.target_id}`
    case 'org':      return `${SITE_BASE}/orgs/${target.target_id}`
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
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

export function generateSnsContent(target: SnsTarget, medium: 'x' | 'facebook' | 'line'): string {
  const link = url(target)
  let prefix = ''
  let body = ''
  let hashtags: string[] = []

  switch (target.target_type) {
    case 'freefree': {
      prefix = freefreePrefix(target.category)
      const loc = target.location ? `（${target.location}）` : ''
      body = `${target.title}${loc}\n${truncate(target.body ?? '', 120)}`
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
  }

  const tagLine = hashtags.join(' ')
  const full = `${prefix}\n${body}\n\n▶ ${link}\n${tagLine}`

  // 媒体別の長さ調整
  if (medium === 'x') {
    // X は本文短め
    const compact = `${prefix} ${truncate(target.title, 50)}\n${truncate(body.replace(target.title, '').replace(/\n+/g, ' '), 80)}\n${link}\n${tagLine}`
    return compact
  }
  return full
}
