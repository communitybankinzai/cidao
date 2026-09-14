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

// Keep known usage even when a completed response cannot be consumed.
export class AIResponseError extends Error {
  constructor(readonly usage: AIUsage | null) {
    super('AI response could not be parsed or was incomplete')
    this.name = 'AIResponseError'
  }
}
