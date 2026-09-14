// Supplementary Node checks for environments where npm cannot install Vitest.
// This does not replace npm test or certify the Vitest suite. No real clients load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import * as nodeCrypto from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
const { createHash } = nodeCrypto
const root = resolve(import.meta.dirname, '../../../..')

function fixture() {
  const rows = {
    cost_rates: [
      ...[2, 10, 2.5, 0.2].map((price, i) => rate('claude-sonnet-5', price, i)),
      ...[5, 25, 6.25, 0.5].map((price, i) => rate('claude-opus-5', price, i)),
      { provider: 'voicevox', model: '*', unit: 'tts_chars', rate_per_unit: 0, currency: 'USD', effective_from: '2026-09-14' },
    ],
    app_settings: [{ key: 'usd_jpy', value: 150 }],
    tts_voices: [{ provider: 'voicevox', voice_id: '3', credit_text: 'VOICEVOX:ずんだもん' }],
    members: [{ id: 'member', display_name: 'test' }],
    consents: [],
  }
  function rate(model, price, i) {
    return { provider: 'anthropic', model, unit: ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'][i], rate_per_unit: price / 1e6, currency: 'USD', effective_from: '2026-09-14' }
  }
  const writes = [], requests = [], logs = []
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'member' } }, error: null }) },
    from(table) {
      if (table === 'api_usage' && state.failLog) throw new Error('private DB details')
      let data = [...(rows[table] ?? [])]
      const query = {
        select: () => query,
        eq: (key, value) => { data = data.filter(row => row[key] === value); return query },
        is: (key, value) => { data = data.filter(row => row[key] === value); return query },
        lte: (key, value) => { data = data.filter(row => row[key] <= value); return query },
        order: () => query,
        limit: count => { data = data.slice(0, count); return query },
        insert: value => { writes.push({ table, value }); data = [{ id: 'created', ...value }]; return query },
        update: value => { writes.push({ table, value }); return query },
        single: async () => ({ data: data[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
        then: callback => Promise.resolve(callback({ data, error: null })),
      }
      return query
    },
  }
  const state = {
    failLog: false,
    sdk: async () => ({ content: [{ type: 'text', text: 'answer' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 } }),
    fetch: async () => { throw new Error('Network forbidden') },
  }
  const modules = new Map()
  function load(filename) {
    const path = resolve(root, filename)
    if (path === resolve(root, 'src/lib/talent-bank/db.ts')) return { createTalentBankServiceClient: () => db, createTalentBankClient: async () => db }
    if (modules.has(path)) return modules.get(path).exports
    const loadedModule = { exports: {} }
    modules.set(path, loadedModule)
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    function localRequire(id) {
      if (id === 'server-only') return {}
      if (id === 'node:crypto') return nodeCrypto
      if (id === '@/lib/talent-bank/db') return { createTalentBankServiceClient: () => db, createTalentBankClient: async () => db }
      if (id === '@anthropic-ai/sdk') return class {
        messages = { create: async params => { requests.push(params); return state.sdk() } }
      }
      if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`)
      if (id.startsWith('.')) return load(resolve(dirname(path), `${id}.ts`))
      throw new Error(`Unexpected dependency forbidden: ${id}`)
    }
    vm.runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports, require: localRequire, Buffer, URL, AbortSignal, performance,
      process: { env: {} }, console: { error: message => logs.push(message) },
      fetch: (...args) => state.fetch(...args),
    }, { filename: path })
    return loadedModule.exports
  }
  return { load, rows, writes, requests, logs, state }
}
const request = { operation: 'chat', purpose: 'interview', system: 'system', messages: [{ role: 'user', content: 'private text' }] }

test('offline: Sonnet/Opus/cache/unknown pricing', async () => {
  const f = fixture(), { estimateCost } = f.load('src/lib/ai/pricing.ts')
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_creation_tokens: 1200, cache_read_tokens: 1000 }
  for (const [model, usd] of [['claude-sonnet-5', 0.0252], ['claude-opus-5', 0.063]]) {
    const cost = await estimateCost({ model, usage })
    assert.equal(cost.status, 'estimated')
    assert.ok(Math.abs(cost.est_cost_usd - usd) < 1e-10)
    assert.ok(Math.abs(cost.est_cost_jpy - usd * 150) < 1e-10)
  }
  const unknown = await estimateCost({ model: 'unknown', usage })
  assert.equal(unknown.status, 'unavailable'); assert.equal(unknown.est_cost_usd, null)
})
test('offline: SDK usage mapped to service usage row and adaptive/caching parameters', async () => {
  const f = fixture(), { callAI } = f.load('src/lib/ai/call.ts')
  const result = await callAI(request)
  const row = f.writes[0].value
  assert.equal(row.run_id, result.runId); assert.match(row.run_id, /^[0-9a-f-]{36}$/)
  assert.equal(row.input_tokens, 100); assert.equal(row.output_tokens, 20)
  assert.equal(row.cache_creation_tokens, 30); assert.equal(row.cache_read_tokens, 40)
  assert.equal(row.status, 'estimated'); assert.equal(row.purpose, 'interview')
  assert.equal(f.requests[0].thinking.type, 'adaptive')
  assert.equal(f.requests[0].system[0].cache_control.type, 'ephemeral')
  assert.ok(!JSON.stringify(row).includes('private text'))
})
test('offline: SDK exception remains unchanged and unavailable is recorded', async () => {
  const f = fixture(), failure = Object.assign(new Error('private details'), { status: 429 })
  f.state.sdk = async () => { throw failure }
  await assert.rejects(f.load('src/lib/ai/call.ts').callAI(request), error => error === failure)
  assert.equal(f.writes[0].value.status, 'unavailable')
  assert.equal(f.writes[0].value.est_cost_usd, null); assert.equal(f.writes[0].value.error, 'quota')
})
test('offline: accounting failure does not fail a successful response', async () => {
  const f = fixture(); f.state.failLog = true
  assert.equal((await f.load('src/lib/ai/call.ts').callAI(request)).text, 'answer')
  assert.equal(f.logs[0], '[talent-bank] api_usage recording failed')
})
test('offline: structured JSON and ranking retain usage', async () => {
  const f = fixture()
  f.state.sdk = async () => ({ content: [{ type: 'text', text: '{"ids":["b","a"]}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } })
  const result = await f.load('src/lib/ai/call.ts').callAI({ operation: 'rank', purpose: 'rank_candidates', system: 'system', prompt: 'rank', candidates: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }] })
  assert.equal(JSON.stringify(result.ranking), '["b","a"]')
  assert.equal(f.requests[0].model, 'claude-opus-5')
  assert.equal(f.requests[0].output_config.format.type, 'json_schema')
})
test('offline: error status classification', () => {
  const { classifyAIError } = fixture().load('src/lib/ai/errors.ts')
  for (const [status, reason] of [[429, 'quota'], [401, 'config'], [529, 'busy'], [503, 'busy'], [413, 'too_large']]) assert.equal(classifyAIError({ status }), reason)
})
test('offline: consent hash/version/scope/revocation/authentication', async () => {
  const f = fixture(), consents = f.load('src/lib/consents.ts')
  await consents.recordConsent({ memberId: 'member', kind: 'photo' })
  const row = f.writes[0].value
  assert.equal(row.text_hash, createHash('sha256').update(consents.CONSENT_TEXTS.photo.text).digest('hex'))
  assert.equal(row.text_version, consents.CONSENT_TEXTS.photo.version)
  f.rows.consents.push({ ...row, revoked_at: null })
  const query = { memberId: 'member', kind: 'photo', version: row.text_version }
  assert.equal(await consents.hasConsent(query), true)
  assert.equal(await consents.hasConsent({ ...query, version: 'old' }), false)
  assert.equal(await consents.hasConsent({ ...query, subjectId: 'other' }), false)
  await consents.revokeConsent({ memberId: 'member', consentId: 'created' })
  assert.equal(Object.keys(f.writes[1].value).join(), 'revoked_at')
  await assert.rejects(consents.recordConsent({ memberId: 'other', kind: 'photo' }))
})
test('offline: VOICEVOX two-stage HTTP, WAV, credit and zero cost', async () => {
  const f = fixture(), calls = [], audio = Buffer.alloc(48044)
  audio.write('RIFF'); audio.write('WAVE', 8); audio.write('fmt ', 12); audio.writeUInt32LE(16, 16)
  audio.writeUInt32LE(48000, 28); audio.write('data', 36); audio.writeUInt32LE(48000, 40)
  f.state.fetch = async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? { ok: true, json: async () => ({ speedScale: 1 }) } : { ok: true, arrayBuffer: async () => audio }
  }
  const { VoicevoxProvider } = f.load('src/lib/tts/voicevox.ts')
  const result = await new VoicevoxProvider().synthesize({ text: '声 & 😀', voiceId: '3' })
  assert.equal(calls.length, 2); assert.equal(calls[0].url.pathname, '/audio_query')
  assert.equal(calls[0].url.searchParams.get('text'), '声 & 😀'); assert.equal(calls[1].url.pathname, '/synthesis')
  assert.equal(calls[1].options.body, '{"speedScale":1}')
  assert.equal(result.durationSec, 1); assert.equal(result.chars, 5); assert.equal(result.creditText, 'VOICEVOX:ずんだもん')
  assert.equal(f.writes[0].value.est_cost_usd, 0); assert.equal(f.writes[0].value.status, 'estimated')
})
