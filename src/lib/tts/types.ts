import type { CallContext } from '@/lib/ai/types'
import type { TTSVoice } from '@/lib/talent-bank/types'

export type SynthesizeInput = CallContext & { text: string; voiceId: string }
export type SynthesizeResult = {
  audio: Buffer; durationSec: number; chars: number; creditText: string; runId: string
}
export interface TTSProvider {
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>
  listVoices(): Promise<TTSVoice[]>
}
