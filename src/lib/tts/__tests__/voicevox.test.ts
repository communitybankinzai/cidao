import { beforeEach, expect, test, vi } from 'vitest'
import { mockDB } from '@/lib/talent-bank/__tests__/mock-db'
import { VoicevoxProvider } from '../voicevox'

const mocks = vi.hoisted(() => ({ service: vi.fn() }))
vi.mock('@/lib/talent-bank/db', () => ({ createTalentBankServiceClient: mocks.service }))
let db: ReturnType<typeof mockDB>
function wav() {
  const audio = Buffer.alloc(44 + 48000)
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8)
  audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22); audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28)
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(48000, 40)
  return audio
}
beforeEach(() => {
  db = mockDB({
    tts_voices: [{ provider: 'voicevox', voice_id: '3', credit_text: 'VOICEVOX:ずんだもん', is_default: true }],
    cost_rates: [{ provider: 'voicevox', model: '*', unit: 'tts_chars', rate_per_unit: 0, currency: 'USD', effective_from: '2026-09-14' }], app_settings: [],
  })
  mocks.service.mockReturnValue(db)
  vi.stubEnv('VOICEVOX_URL', 'http://voicevox.invalid:50021')
})
test('performs audio_query then synthesis, returns DB credit and records zero cost with duration', async () => {
  const audio = wav()
  const query = { accent_phrases: [], speedScale: 1, outputSamplingRate: 24000 }
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => query })
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) })
  vi.stubGlobal('fetch', fetchMock)
  const result = await new VoicevoxProvider().synthesize({ text: '声 & 😀', voiceId: '3', caseId: 'case' })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  const first = fetchMock.mock.calls[0][0] as URL
  expect(first.origin).toBe('http://voicevox.invalid:50021')
  expect(first.pathname).toBe('/audio_query')
  expect(first.searchParams.get('text')).toBe('声 & 😀')
  expect(first.searchParams.get('speaker')).toBe('3')
  expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  expect((fetchMock.mock.calls[1][0] as URL).pathname).toBe('/synthesis')
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify(query), headers: { 'Content-Type': 'application/json' } })
  expect(result).toMatchObject({ durationSec: 1, chars: 5, creditText: 'VOICEVOX:ずんだもん' })
  expect(result.audio.equals(audio)).toBe(true)
  expect(db.writes[0].value).toMatchObject({ run_id: result.runId, tts_chars: 5, audio_seconds: 1, status: 'estimated', est_cost_usd: 0, est_cost_jpy: 0 })
  expect(db.writes[0].value.render_seconds).toBeGreaterThanOrEqual(0)
})
test('does not call synthesis after query failure; logs only a safe error code', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
  vi.stubGlobal('fetch', fetchMock)
  await expect(new VoicevoxProvider().synthesize({ text: 'private', voiceId: '3' })).rejects.toThrow('VOICEVOX synthesis failed')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(db.writes[0].value).toMatchObject({ status: 'unavailable', est_cost_usd: null, error: 'tts_failed' })
  expect(JSON.stringify(db.writes)).not.toContain('private')
})
test('lists configured voices without invoking the engine', async () => {
  expect((await new VoicevoxProvider().listVoices())[0].credit_text).toBe('VOICEVOX:ずんだもん')
  expect(fetch).not.toHaveBeenCalled()
})
