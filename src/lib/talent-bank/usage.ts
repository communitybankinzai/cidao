import 'server-only'
import { createTalentBankServiceClient } from './db'
import type { ApiUsageInsert } from './types'

export async function recordApiUsage(row: ApiUsageInsert): Promise<void> {
  try {
    const { error } = await createTalentBankServiceClient().from('api_usage').insert(row)
    if (error) throw new Error('Usage insert failed')
  } catch {
    // Never log SDK/DB errors: they may contain prompts, personal data or credentials.
    console.error('[talent-bank] api_usage recording failed')
  }
}
