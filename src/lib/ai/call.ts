import 'server-only'
import { randomUUID } from 'node:crypto'
import { AnthropicProvider } from './anthropic'
import type { AIProvider, AIRequest, AIResponse, AIUsage } from './types'
import { AIResponseError, classifyAIError, describeAIError } from './errors'
import { estimateCost, unavailableCost } from './pricing'
import { recordApiUsage } from '@/lib/talent-bank/usage'

/** The only application entry point for Phase 1 AI calls; await it even for streaming. */
export async function callAI(input: AIRequest, provider: AIProvider = new AnthropicProvider()): Promise<AIResponse & { runId: string }> {
  const runId = randomUUID()
  let usage: AIUsage | null = null
  let errorKind: string | null = null
  const model = provider.modelForPurpose(input.purpose)
  try {
    let response: AIResponse
    switch (input.operation) {
      case 'chat': response = await provider.chat(input); break
      case 'extractStructured': response = await provider.extractStructured(input); break
      case 'generateText': response = await provider.generateText(input); break
      case 'rank': response = await provider.rank(input); break
    }
    usage = response.usage
    return { ...response, runId }
  } catch (error) {
    errorKind = classifyAIError(error)
    if (errorKind === 'unknown') {
      // 分類外の失敗は原因が追えないので、status/種別/例外名（＋400系ならメッセージ先頭）を残す。
      const detail = describeAIError(error)
      errorKind = `unknown:${detail}`.slice(0, 300)
      console.error(`[talent-bank] AI call failed purpose=${input.purpose} model=${model} detail=${detail}`)
    }
    if (error instanceof AIResponseError) usage = error.usage
    throw error
  } finally {
    // Isolate the entire accounting path, including unexpected pricing failures.
    try {
      const cost = usage ? await estimateCost({ provider: provider.name, model, usage }) : unavailableCost()
      await recordApiUsage({
        run_id: runId, case_id: input.caseId ?? null, subject_id: input.subjectId ?? null, member_id: input.memberId ?? null,
        provider: provider.name, model, purpose: input.purpose,
        input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
        cache_creation_tokens: usage?.cache_creation_tokens ?? null, cache_read_tokens: usage?.cache_read_tokens ?? null,
        ...cost, error: errorKind,
      })
    } catch { console.error('[talent-bank] AI accounting failed') }
  }
}
