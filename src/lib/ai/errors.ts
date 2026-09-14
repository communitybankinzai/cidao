import type { AIUsage } from './types'

export type AIErrorKind = 'quota' | 'config' | 'busy' | 'too_large' | 'parse' | 'unknown'

// Preserve the event-scan categories without changing that module or its callers.
// Unlike the legacy classifier, this function never logs raw exception messages.
export function classifyAIError(error: unknown): AIErrorKind {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
  const message = error instanceof Error ? error.message : ''
  if (/credit balance/i.test(message) || status === 429) return 'quota'
  if (status === 401 || status === 403) return 'config'
  if (status === 529 || status === 503 || /timeout|timed out|aborted/i.test(message)) return 'busy'
  if (status === 413) return 'too_large'
  if (error instanceof SyntaxError || error instanceof AIResponseError) return 'parse'
  return 'unknown'
}

// 分類できない失敗の切り分け用。HTTP status・API エラー種別・例外名と、
// リクエスト形式の誤り（400/404/422）のときだけメッセージ先頭 160 字を返す（本文や個人情報は含まれない）。
export function describeAIError(error: unknown): string {
  const e = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>
  const status = typeof e.status === 'number' ? e.status : '-'
  const body = (typeof e.error === 'object' && e.error !== null ? e.error : {}) as Record<string, unknown>
  const inner = (typeof body.error === 'object' && body.error !== null ? body.error : body) as Record<string, unknown>
  const type = typeof inner.type === 'string' ? inner.type : '-'
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error && [400, 404, 422].includes(status as number) ? error.message.slice(0, 160) : ''
  return `${status}/${type}/${name}${message ? `/${message}` : ''}`
}

// Keep known usage even when a completed response cannot be consumed.
export class AIResponseError extends Error {
  constructor(readonly usage: AIUsage | null) {
    super('AI response could not be parsed or was incomplete')
    this.name = 'AIResponseError'
  }
}
