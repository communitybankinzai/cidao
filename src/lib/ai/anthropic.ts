import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'
import type { AIProvider, AIPurpose, AIResponse, ChatInput, StructuredInput, TextInput, RankInput } from './types'
import { AIResponseError } from './errors'

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  modelForPurpose(purpose: AIPurpose): string {
    return ['video_script', 'sns_caption', 'rank_candidates'].includes(purpose) ? 'claude-opus-5' : 'claude-sonnet-5'
  }

  private async request(input: ChatInput, schema?: Record<string, unknown>): Promise<AIResponse> {
    // Sonnet/Opus 5 reject assistant prefills. Historical assistant turns are allowed.
    if (!input.messages.length || input.messages.at(-1)?.role !== 'user') {
      throw new Error('AI conversation must end with a user message')
    }
    const params: MessageCreateParamsNonStreaming = {
      model: this.modelForPurpose(input.purpose), max_tokens: input.maxTokens ?? 4096,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      messages: input.messages,
      ...(schema ? { output_config: { format: { type: 'json_schema' as const, schema } } } : {}),
    }
    // Use SDK default retries for 429/5xx; do not add application retries.
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    let message: Message
    if (input.onText) {
      const stream = client.messages.stream(params)
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') input.onText(event.delta.text)
        }
        message = await stream.finalMessage()
      } catch (error) {
        stream.abort()
        throw error
      }
    } else {
      message = await client.messages.create(params)
    }
    const usage = message.usage ? {
      input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens,
      cache_creation_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cache_read_tokens: message.usage.cache_read_input_tokens ?? 0,
    } : null
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (message.stop_reason !== 'end_turn' || !text) throw new AIResponseError(usage)
    return { model: params.model, text, usage }
  }

  chat(input: ChatInput) { return this.request(input) }
  generateText(input: TextInput) {
    return this.request({ ...input, messages: [{ role: 'user', content: input.prompt }] })
  }
  async extractStructured(input: StructuredInput): Promise<AIResponse> {
    const response = await this.request({ ...input, messages: [{ role: 'user', content: input.prompt }] }, input.schema)
    try { return { ...response, structured: JSON.parse(response.text) as unknown } }
    catch { throw new AIResponseError(response.usage) }
  }
  async rank(input: RankInput): Promise<AIResponse> {
    const ids = input.candidates.map(candidate => candidate.id)
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Candidates must have unique IDs and not be empty')
    const response = await this.extractStructured({
      ...input,
      prompt: `${input.prompt}\nReturn each candidate ID exactly once, in ranked order.\n${JSON.stringify(input.candidates)}`,
      schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string', enum: ids } } }, required: ['ids'], additionalProperties: false },
    })
    const value = response.structured
    const ranked = typeof value === 'object' && value !== null && 'ids' in value ? value.ids : null
    if (!Array.isArray(ranked) || ranked.length !== ids.length || new Set(ranked).size !== ids.length ||
      !ranked.every((id): id is string => typeof id === 'string' && ids.includes(id))) throw new AIResponseError(response.usage)
    return { ...response, ranking: ranked }
  }
}
