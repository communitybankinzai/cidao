import { beforeEach, expect, test, vi } from 'vitest'
import { mockDB } from '@/lib/talent-bank/__tests__/mock-db'
import type { AIRequest } from '../types'

const mocks = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn(), service: vi.fn(), constructor: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  messages = { create: mocks.create, stream: mocks.stream }
  constructor(options: unknown) { mocks.constructor(options) }
} }))
vi.mock('@/lib/talent-bank/db', () => ({ createTalentBankServiceClient: mocks.service }))

const response = () => ({
  model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'answer' }],
  usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
})
const request: AIRequest = { operation: 'chat', purpose: 'interview', system: 'system', messages: [{ role: 'user', content: 'private' }], caseId: 'case', subjectId: 'subject', memberId: 'member' }
let db: ReturnType<typeof mockDB>
beforeEach(() => {
  vi.resetModules()
  db = mockDB({ cost_rates: ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'].map(unit => ({
    provider: 'anthropic', model: 'claude-sonnet-5', unit, rate_per_unit: 0.000001, currency: 'USD', effective_from: '2026-09-14',
  })), app_settings: [] })
  mocks.service.mockReturnValue(db)
  mocks.create.mockResolvedValue(response())
})
test('logs SDK usage through service_role with run_id, context, purpose and status', async () => {
  const { callAI } = await import('../call')
  const result = await callAI(request)
  expect(result.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(db.writes).toHaveLength(1)
  expect(db.writes[0]).toMatchObject({ table: 'api_usage', value: {
    run_id: result.runId, case_id: 'case', subject_id: 'subject', member_id: 'member',
    input_tokens: 100, output_tokens: 20, cache_creation_tokens: 30, cache_read_tokens: 40,
    provider: 'anthropic', model: 'claude-sonnet-5', purpose: 'interview', status: 'estimated', error: null,
  } })
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    thinking: { type: 'adaptive' }, system: [{ type: 'text', text: 'system', cache_control: { type: 'ephemeral' } }],
  }))
  expect(JSON.stringify(db.writes)).not.toContain('private')
  expect(mocks.constructor.mock.calls[0][0]).not.toHaveProperty('maxRetries')
})
test('SDK failure is rethrown unchanged and creates one unavailable row without sensitive error text', async () => {
  const failure = Object.assign(new Error('private message and secret'), { status: 429 })
  mocks.create.mockRejectedValue(failure)
  const { callAI } = await import('../call')
  await expect(callAI(request)).rejects.toBe(failure)
  expect(db.writes).toHaveLength(1)
  expect(db.writes[0].value).toMatchObject({ status: 'unavailable', input_tokens: null, est_cost_usd: null, est_cost_jpy: null, error: 'quota' })
  expect(JSON.stringify(db.writes)).not.toContain('private')
})
test('usage recording failure cannot fail the AI result and logs no DB details', async () => {
  const original = db.from.getMockImplementation()!
  db.from.mockImplementation((table: string) => {
    if (table === 'api_usage') throw new Error('sensitive DB error')
    return original(table)
  })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { callAI } = await import('../call')
  expect((await callAI(request)).text).toBe('answer')
  expect(log).toHaveBeenCalledWith('[talent-bank] api_usage recording failed')
  expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive')
})
test('successful response without usage remains unavailable', async () => {
  mocks.create.mockResolvedValue({ ...response(), usage: undefined })
  const { callAI } = await import('../call')
  await callAI(request)
  expect(db.writes[0].value).toMatchObject({ status: 'unavailable', est_cost_usd: null })
})
test('structured output uses output_config and preserves known usage after a parse failure', async () => {
  const { callAI } = await import('../call')
  await expect(callAI({ operation: 'extractStructured', purpose: 'extract_profile', system: 'system', prompt: 'prompt', schema: { type: 'object' } })).rejects.toThrow('parsed')
  expect(mocks.create.mock.calls[0][0]).toHaveProperty('output_config.format.type', 'json_schema')
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('output_format')
  expect(db.writes[0].value).toMatchObject({ status: 'estimated', input_tokens: 100, error: 'parse' })
})
test('streams text and records final usage once after completion', async () => {
  const finalMessage = vi.fn().mockResolvedValue(response())
  mocks.stream.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'internal' } }
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } }
    }, finalMessage, abort: vi.fn(),
  })
  const onText = vi.fn()
  const { callAI } = await import('../call')
  await callAI({ ...request, onText })
  expect(onText).toHaveBeenCalledExactlyOnceWith('answer')
  expect(finalMessage).toHaveBeenCalledOnce()
  expect(db.writes).toHaveLength(1)
  expect(db.writes[0].value.output_tokens).toBe(20)
})
test('stream interruption records unavailable and aborts the stream', async () => {
  const failure = new Error('stream aborted')
  const abort = vi.fn()
  mocks.stream.mockReturnValue({ async *[Symbol.asyncIterator]() { yield { type: 'ping' }; throw failure }, abort })
  const { callAI } = await import('../call')
  await expect(callAI({ ...request, onText: vi.fn() })).rejects.toBe(failure)
  expect(abort).toHaveBeenCalledOnce()
  expect(db.writes[0].value).toMatchObject({ status: 'unavailable', error: 'busy' })
})
test.each(['video_script', 'sns_caption', 'rank_candidates'] as const)('routes %s to Opus 5', async (purpose: 'video_script' | 'sns_caption' | 'rank_candidates') => {
  const { callAI } = await import('../call')
  await callAI({ operation: 'generateText', purpose, system: 'system', prompt: 'prompt' })
  expect(mocks.create.mock.calls[0][0].model).toBe('claude-opus-5')
})
test('rank accepts a permutation and rejects hallucinated candidate IDs', async () => {
  const { callAI } = await import('../call')
  const rank: AIRequest = { operation: 'rank', purpose: 'rank_candidates', system: 'system', prompt: 'rank', candidates: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }] }
  mocks.create.mockResolvedValue({ ...response(), content: [{ type: 'text', text: '{"ids":["b","a"]}' }] })
  expect((await callAI(rank)).ranking).toEqual(['b', 'a'])
  mocks.create.mockResolvedValue({ ...response(), content: [{ type: 'text', text: '{"ids":["b","unknown"]}' }] })
  await expect(callAI(rank)).rejects.toThrow('parsed')
})
