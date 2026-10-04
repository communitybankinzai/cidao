// FreeFree 掲載を編集したとき、「SNS の紹介文が前回から変わったか」を判定する部品（2026-10-05・事業主指示）。
// 変わっていれば新しい版を自動で SNS に出し、変わっていなければ何もしない。
//
// 比べる前にそろえるもの:
//   - 冒頭のカウントダウン行（「⏳ 掲載終了まであと31日…」）は、日が変わるだけで毎日違う。除いて比べる
//   - 改行コード（\r\n と \n）と、行末の空白・前後の空行の違い

export const REPOST_MIN_INTERVAL_HOURS = 24

// 「前回の配信から24時間以内」のため自動では出さず、承認待ちにした下書きの印（sns_post_logs.error_message の先頭）。
// 管理画面の承認待ちカードがこの文言で見分けて、運営に理由を表示する
export const HELD_WITHIN_24H_NOTE = `前回の配信から${REPOST_MIN_INTERVAL_HOURS}時間以内のため、自動では出さず承認待ちにしています`

export function comparableSnsContent(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^⏳[^\n]*\n/, '')
    .split('\n')
    .map((line) => line.replace(/[ \t　]+$/g, ''))
    .join('\n')
    .trim()
}

// 紹介文の中身が同じか（カウントダウンの日数・改行の違いは無視）
export function isSameSnsContent(a: string | null | undefined, b: string | null | undefined): boolean {
  return comparableSnsContent(a) === comparableSnsContent(b)
}

// 同じ掲載・同じ媒体への自動の出し直しは、前回の配信から 24 時間あける（1日に何度も編集されても連投にならないように）。
// あけた分の編集は、次の定期紹介が配信時の最新の中身で出す
export function canRepostNow(lastPostedAtIso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!lastPostedAtIso) return true
  const last = Date.parse(lastPostedAtIso)
  if (Number.isNaN(last)) return true
  return nowMs - last >= REPOST_MIN_INTERVAL_HOURS * 3600_000
}
