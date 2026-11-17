// Instagram の巡回先から取り込んだ催しを、自動で公開するかを決める（2026-11-18 事業主決定A）。
//
// 方針：公開情報をもとに先に載せ、望まれないものを外す。
//   ・巡回先に登録したアカウントの投稿で、読み取りに欠けがなければ、そのまま公開する
//   ・欠けがあるもの、「下書きのまま」と決めた巡回先（sns_monitor_accounts.auto_publish=false）、
//     ハッシュタグ検索で拾った投稿（主催者が分からないものを含む）は、これまでどおり下書き
// DB を使わない純粋な関数（テストしやすくするため、依存を持たせない）。

/** 何日先の催しまで自動で公開するか。これより先は、年の読み違いの疑いがあるので下書きに残す */
export const AUTO_PUBLISH_MAX_DAYS_AHEAD = 183

export type AutoPublishInput = {
  /** 巡回先のアカウント由来か（ハッシュタグ検索由来なら false） */
  fromAccount: boolean
  /** 巡回先の設定（sns_monitor_accounts.auto_publish）。未設定は true とみなす */
  accountAutoPublish?: boolean | null
  title: string
  location: string
  onlineFlag: boolean
  /** 時刻がチラシから読めず、仮置きになっているか */
  timeAssumed: boolean
  /** 開催日（JST・YYYY-MM-DD） */
  date: string
  /** きょう（JST・YYYY-MM-DD） */
  today: string
}

export type AutoPublishDecision = { publish: true } | { publish: false; reason: string }

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return Math.round((b - a) / 86_400_000)
}

export function decideAutoPublish(i: AutoPublishInput): AutoPublishDecision {
  if (!i.fromAccount) return { publish: false, reason: 'ハッシュタグ検索の投稿' }
  if (i.accountAutoPublish === false) return { publish: false, reason: '巡回先の設定が下書きのまま' }
  const title = i.title.trim()
  if (!title || title === '（題名なし）') return { publish: false, reason: '題名が読めない' }
  if (i.timeAssumed) return { publish: false, reason: '時刻が仮置き' }
  if (!i.onlineFlag && !i.location.trim()) return { publish: false, reason: '会場が読めない' }
  const ahead = daysBetween(i.today, i.date)
  if (Number.isNaN(ahead) || ahead < 0) return { publish: false, reason: '開催日が不正' }
  if (ahead > AUTO_PUBLISH_MAX_DAYS_AHEAD) return { publish: false, reason: `開催日が${AUTO_PUBLISH_MAX_DAYS_AHEAD}日より先` }
  return { publish: true }
}

/** 報告（登録した催しのラベル）に付ける印 */
export function autoPublishMark(d: AutoPublishDecision): string {
  return d.publish ? '〔公開〕' : `〔下書き：${d.reason}〕`
}
