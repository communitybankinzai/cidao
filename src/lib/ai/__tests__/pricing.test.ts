import { beforeEach, expect, test, vi } from 'vitest'
import { mockDB } from '@/lib/talent-bank/__tests__/mock-db'

const mocks = vi.hoisted(() => ({ service: vi.fn() }))
vi.mock('@/lib/talent-bank/db', () => ({ createTalentBankServiceClient: mocks.service }))
const units = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens']
const rates = [
  ...[2, 10, 2.5, 0.2].map((rate, i) => ({ provider: 'anthropic', model: 'claude-sonnet-5', unit: units[i], rate_per_unit: rate / 1e6, currency: 'USD', effective_from: '2026-09-14' })),
  ...[5, 25, 6.25, 0.5].map((rate, i) => ({ provider: 'anthropic', model: 'claude-opus-5', unit: units[i], rate_per_unit: rate / 1e6, currency: 'USD', effective_from: '2026-09-14' })),
]
beforeEach(() => { vi.resetModules(); vi.useRealTimers(); mocks.service.mockReturnValue(mockDB({ cost_rates: rates, app_settings: [] })) })

test.each([['claude-sonnet-5', 0.0252], ['claude-opus-5', 0.063]] as const)('calculates all token categories for %s', async (model: string, usd: number) => {
  const { estimateCost } = await import('../pricing')
  const result = await estimateCost({ model, usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_tokens: 1200, cache_read_tokens: 1000 } })
  expect(result.status).toBe('estimated')
  expect(result.est_cost_usd).toBeCloseTo(usd)
  expect(result.est_cost_jpy).toBeCloseTo(usd * 150)
  expect(result.rate_version).toContain('cache_read_tokens@2026-09-14')
})
test('cache reads cost one tenth of uncached input', async () => {
  const { estimateCost } = await import('../pricing')
  const base = { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 }
  const read = await estimateCost({ model: 'claude-sonnet-5', usage: { ...base, cache_read_tokens: 1e6 } })
  const input = await estimateCost({ model: 'claude-sonnet-5', usage: { ...base, input_tokens: 1e6 } })
  expect(read.est_cost_usd).toBeCloseTo(0.2)
  expect(input.est_cost_usd).toBeCloseTo(2)
})
test('unknown model and missing rate are unavailable, not free', async () => {
  const { estimateCost } = await import('../pricing')
  expect(await estimateCost({ model: 'unknown', usage: { input_tokens: 1, output_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 0 } }))
    .toMatchObject({ status: 'unavailable', est_cost_usd: null, est_cost_jpy: null })
})
test('uses effective date, DB FX and refreshes cached rates after 60 seconds', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:00:00Z'))
  const tables = { cost_rates: [...rates, { ...rates[0], effective_from: '2026-09-15', rate_per_unit: 99 }], app_settings: [{ key: 'usd_jpy', value: 160 }] }
  mocks.service.mockReturnValue(mockDB(tables))
  const { estimateCost } = await import('../pricing')
  const request = { model: 'claude-sonnet-5', usage: { input_tokens: 1e6, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 } }
  expect((await estimateCost(request)).est_cost_jpy).toBe(320)
  tables.app_settings[0].value = 170
  expect((await estimateCost(request)).est_cost_jpy).toBe(320)
  vi.advanceTimersByTime(60_001)
  expect((await estimateCost(request)).est_cost_jpy).toBe(340)
  vi.useRealTimers()
})
test('VOICEVOX configured zero is estimated', async () => {
  mocks.service.mockReturnValue(mockDB({ cost_rates: [{ provider: 'voicevox', model: '*', unit: 'tts_chars', rate_per_unit: 0, currency: 'USD', effective_from: '2026-09-14' }], app_settings: [] }))
  const { estimateCost } = await import('../pricing')
  expect(await estimateCost({ provider: 'voicevox', model: '*', usage: { tts_chars: 30 } })).toMatchObject({ status: 'estimated', est_cost_usd: 0, est_cost_jpy: 0 })
})
