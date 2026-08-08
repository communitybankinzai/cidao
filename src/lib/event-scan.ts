// イベント AI 抽出（チラシ画像 / サイト URL）で共有するエラー分類。
// 呼び出し元: /api/events/scan（画像）, /api/events/scan-url（URL）

import Anthropic from '@anthropic-ai/sdk'

// quota: クレジット不足・レート制限 / config: キー不正 / busy: 過負荷・タイムアウト
// too_large: 入力が上限超え / parse: 応答が解釈できない / fetch: ページ取得失敗
// blocked_url: 許可されない URL / no_events: イベントが見つからない / unknown: その他
export type ScanFailReason =
  | 'quota'
  | 'config'
  | 'busy'
  | 'too_large'
  | 'parse'
  | 'fetch'
  | 'blocked_url'
  | 'no_events'
  | 'unknown'

export function classifyScanError(err: unknown, logTag: string): ScanFailReason {
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[${logTag}] AI extraction failed:`, status ?? '(no status)', message)
  if (/credit balance/i.test(message)) return 'quota'
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'config'
  if (status === 529 || status === 503) return 'busy'
  if (/timeout|timed out|aborted/i.test(message)) return 'busy'
  return 'unknown'
}
