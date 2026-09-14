import type { Database, Json } from '@/lib/supabase/database.types'

export type ConsentKind = 'interview' | 'profile' | 'photo' | 'video' | 'sns' | 'bank' | 'matching' | 'external_ai'
export type UsageStatus = 'estimated' | 'unavailable' | 'reconciled'
export type RateUnit = 'input_tokens' | 'output_tokens' | 'cache_creation_tokens' | 'cache_read_tokens' | 'tts_chars' | 'image'
export type TalentSubject = {
  id: string; owner_member_id: string; subject_type: 'person' | 'shop' | 'org'
  organization_id: string | null; display_name: string; is_adult_confirmed: boolean
  created_at: string; updated_at: string
}
export type Consent = {
  id: string; member_id: string; subject_id: string | null; kind: ConsentKind
  text_version: string; text_hash: string; agreed_at: string; revoked_at: string | null; ip_hash: string | null
}
export type ApiUsage = {
  id: string; run_id: string; case_id: string | null; subject_id: string | null; member_id: string | null
  provider: string; model: string; purpose: string
  input_tokens: number | null; output_tokens: number | null
  cache_creation_tokens: number | null; cache_read_tokens: number | null
  audio_seconds: number | null; tts_chars: number | null; render_seconds: number | null
  storage_bytes: number | null; image_count: number | null
  rate_version: string | null; currency: string; fx_rate: number | null
  est_cost_usd: number | null; est_cost_jpy: number | null; status: UsageStatus
  error: string | null; created_at: string
}
export type CostRate = {
  id: string; provider: string; model: string; unit: RateUnit; rate_per_unit: number
  currency: string; effective_from: string; note: string | null; created_at: string
}
export type TTSVoice = {
  id: string; provider: string; voice_id: string; display_name: string; credit_text: string
  commercial_ok: boolean; terms_url: string; is_default: boolean; created_at: string
}
export type WorkLog = {
  id: string; actor_member_id: string; case_id: string | null; subject_id: string | null
  kind: 'profile_review' | 'text_edit' | 'video_review' | 'video_edit' | 'inquiry_support' | 'ops' | 'illustration'
  started_at: string; ended_at: string | null; minutes: number | null; edit_count: number
  note: string | null; created_at: string
}
type Table<Row, Required extends keyof Row, Update = Partial<Row>> = {
  Row: Row; Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>; Update: Update; Relationships: []
}
type Phase1Tables = {
  talent_subjects: Table<TalentSubject, 'owner_member_id' | 'subject_type' | 'display_name'>
  consents: Table<Consent, 'member_id' | 'kind' | 'text_version' | 'text_hash', { revoked_at?: string }>
  api_usage: Table<ApiUsage, 'run_id' | 'provider' | 'model' | 'purpose' | 'status'>
  cost_rates: Table<CostRate, 'provider' | 'model' | 'unit' | 'rate_per_unit' | 'effective_from'>
  tts_voices: Table<TTSVoice, 'provider' | 'voice_id' | 'display_name' | 'credit_text' | 'terms_url'>
  work_logs: Table<WorkLog, 'actor_member_id' | 'kind' | 'started_at'>
  // Existing generated types predate app_settings; this mirrors its existing migration.
  app_settings: Table<{ key: string; value: Json; updated_at: string; updated_by: string | null }, 'key' | 'value'>
}
export type TalentBankDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & { Tables: Database['public']['Tables'] & Phase1Tables }
}
export type ApiUsageInsert = Phase1Tables['api_usage']['Insert']
