import 'server-only'
import { createTalentBankServiceClient } from '@/lib/talent-bank/db'
import type { CostRate, RateUnit } from '@/lib/talent-bank/types'
import type { AIUsage } from './types'

export type CostEstimate = {
  status: 'estimated' | 'unavailable'; est_cost_usd: number | null; est_cost_jpy: number | null
  currency: 'USD'; fx_rate: number | null; rate_version: string | null
}
export function unavailableCost(): CostEstimate {
  return { status: 'unavailable', est_cost_usd: null, est_cost_jpy: null, currency: 'USD', fx_rate: null, rate_version: null }
}
let cache: { expires: number; date: string; rates: CostRate[]; fx: number } | undefined

export async function estimateCost({ model, usage, provider = 'anthropic' }: {
  model: string; usage: AIUsage | { tts_chars: number }; provider?: string
}): Promise<CostEstimate> {
  try {
    const date = new Date().toISOString().slice(0, 10)
    if (!cache || cache.expires <= Date.now() || cache.date !== date) {
      const db = createTalentBankServiceClient()
      const [rates, setting] = await Promise.all([
        db.from('cost_rates').select('*').lte('effective_from', date).order('effective_from', { ascending: false }),
        db.from('app_settings').select('value').eq('key', 'usd_jpy').maybeSingle(),
      ])
      if (rates.error || setting.error) throw new Error('Pricing lookup failed')
      const fx = setting.data ? Number(setting.data.value) : 150
      if (!Number.isFinite(fx) || fx <= 0) throw new Error('Invalid FX rate')
      cache = { expires: Date.now() + 60_000, date, rates: rates.data ?? [], fx }
    }
    const units: RateUnit[] = 'tts_chars' in usage ? ['tts_chars'] : ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens']
    let usd = 0
    const versions: string[] = []
    for (const unit of units) {
      // Prefer a model-specific rate, then an explicitly configured wildcard.
      const eligible = cache.rates.filter(rate => rate.provider === provider && rate.unit === unit)
      const rate = eligible.find(rate => rate.model === model) ?? eligible.find(rate => rate.model === '*')
      const quantity = 'tts_chars' in usage ? usage.tts_chars : usage[unit as keyof AIUsage]
      if (!rate || rate.currency !== 'USD' || !Number.isFinite(Number(rate.rate_per_unit)) || Number(rate.rate_per_unit) < 0 ||
        !Number.isInteger(quantity) || quantity < 0) return unavailableCost()
      usd += quantity * Number(rate.rate_per_unit)
      versions.push(`${rate.provider}/${rate.model}/${unit}@${rate.effective_from}`)
    }
    return { status: 'estimated', est_cost_usd: usd, est_cost_jpy: usd * cache.fx,
      currency: 'USD', fx_rate: cache.fx, rate_version: versions.join(';') }
  } catch {
    console.error('[talent-bank] cost estimation unavailable')
    return unavailableCost()
  }
}
