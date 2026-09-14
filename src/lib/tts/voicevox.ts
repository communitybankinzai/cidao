import 'server-only'
import { randomUUID } from 'node:crypto'
import { createTalentBankServiceClient } from '@/lib/talent-bank/db'
import { recordApiUsage } from '@/lib/talent-bank/usage'
import { estimateCost, unavailableCost } from '@/lib/ai/pricing'
import type { TTSProvider, SynthesizeInput, SynthesizeResult } from './types'

// Read the actual PCM WAV duration; synthesis elapsed time is measured separately.
function wavDuration(audio: Buffer): number {
  if (audio.length < 12 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid TTS WAV')
  let byteRate = 0
  let dataBytes = 0
  for (let offset = 12; offset + 8 <= audio.length;) {
    const kind = audio.toString('ascii', offset, offset + 4)
    const size = audio.readUInt32LE(offset + 4)
    if (offset + 8 + size > audio.length) throw new Error('Truncated TTS WAV')
    if (kind === 'fmt ' && size >= 16) byteRate = audio.readUInt32LE(offset + 16)
    if (kind === 'data') dataBytes += size
    offset += 8 + size + (size % 2)
  }
  if (byteRate <= 0 || dataBytes <= 0) throw new Error('Invalid TTS WAV duration')
  return dataBytes / byteRate
}

export class VoicevoxProvider implements TTSProvider {
  async listVoices() {
    const { data, error } = await createTalentBankServiceClient().from('tts_voices').select('*')
      .eq('provider', 'voicevox').order('is_default', { ascending: false })
    if (error) throw new Error('TTS voice configuration unavailable')
    return data ?? []
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const runId = randomUUID()
    const started = performance.now()
    const chars = Array.from(input.text).length
    let durationSec: number | null = null
    let succeeded = false
    let errorCode: string | null = null
    try {
      if (!chars || !/^\d+$/.test(input.voiceId)) throw new Error('Invalid TTS input')
      const voice = (await this.listVoices()).find(item => item.voice_id === input.voiceId)
      if (!voice) throw new Error('TTS voice unavailable')
      const base = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021'
      const queryURL = new URL('/audio_query', base)
      queryURL.searchParams.set('text', input.text)
      queryURL.searchParams.set('speaker', input.voiceId)
      const queryResponse = await fetch(queryURL, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(60_000) })
      if (!queryResponse.ok) throw new Error('TTS audio_query failed')
      const query: unknown = await queryResponse.json()
      const synthesisURL = new URL('/synthesis', base)
      synthesisURL.searchParams.set('speaker', input.voiceId)
      const response = await fetch(synthesisURL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
        cache: 'no-store', signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error('TTS synthesis failed')
      const audio = Buffer.from(await response.arrayBuffer())
      durationSec = wavDuration(audio)
      succeeded = true
      return { audio, durationSec, chars, creditText: voice.credit_text, runId }
    } catch {
      // Fetch errors may embed the audio_query URL (which contains the input text).
      errorCode = 'tts_failed'
      throw new Error('VOICEVOX synthesis failed')
    } finally {
      const renderSeconds = (performance.now() - started) / 1000
      try {
        const cost = succeeded ? await estimateCost({ provider: 'voicevox', model: '*', usage: { tts_chars: chars } }) : unavailableCost()
        await recordApiUsage({
          run_id: runId, case_id: input.caseId ?? null, subject_id: input.subjectId ?? null, member_id: input.memberId ?? null,
          provider: 'voicevox', model: '*', purpose: 'video_narration', tts_chars: chars,
          audio_seconds: durationSec, render_seconds: renderSeconds, ...cost, error: errorCode,
        })
      } catch { console.error('[talent-bank] TTS accounting failed') }
    }
  }
}
