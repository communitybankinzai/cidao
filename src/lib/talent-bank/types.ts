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
export type CollectedField = {
  state: 'answered' | 'none' | 'declined' | 'unknown'
  value: string | null; evidence: string[]; updated_at: string
}
export type CollectedFields = Record<string, CollectedField>
export type Interview = {
  id: string; subject_id: string; member_id: string; kind: 'talent' | 'request'
  status: 'active' | 'paused' | 'done' | 'abandoned'
  collected_json: CollectedFields; sufficiency_json: Json | null; turn_count: number
  started_at: string; last_activity_at: string; completed_at: string | null
  created_at: string; updated_at: string
}
export type InterviewMessage = {
  id: string; interview_id: string; seq: number; role: 'user' | 'assistant' | 'system'
  content: string; run_id: string | null; created_at: string
}
type Table<Row, Required extends keyof Row, Update = Partial<Row>> = {
  Row: Row; Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>; Update: Update; Relationships: []
}
type Phase1Tables = {
  talent_profiles: Table<TalentProfile, 'subject_id' | 'member_id'>
  talent_profile_versions: Table<ProfileVersion, 'profile_id' | 'version' | 'fields_json'>
  talent_tags: Table<TalentTag, 'slug' | 'label' | 'kind'>
  tag_synonyms: Table<{ id: string; tag_id: string; synonym: string }, 'tag_id' | 'synonym'>
  talent_profile_version_tags: Table<VersionTag, 'version_id' | 'tag_id' | 'source'>
  publications: Table<Publication, 'profile_id' | 'version_id' | 'scope' | 'owner_approved_at' | 'admin_approved_by' | 'admin_approved_at' | 'published_at'>
  interviews: Table<Interview, 'subject_id' | 'member_id'>
  interview_messages: Table<InterviewMessage, 'interview_id' | 'seq' | 'role' | 'content', never>
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
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: Database['public']['Tables'] & Phase1Tables
    Functions: Database['public']['Functions'] & {
      save_talent_draft: { Args: { p_subject: string; p_fields: Json; p_short: string; p_long: string; p_run: string | null; p_tags: string[]; p_suggested: string[]; p_scope: string }; Returns: string }
      edit_talent_draft: { Args: { p_version: string; p_expected: string; p_fields: Json; p_short: string; p_long: string; p_tags: string[]; p_scope: string; p_approve: boolean }; Returns: boolean }
      approve_talent_owner: { Args: { p_version: string; p_expected: string }; Returns: boolean }
      publish_talent_version: { Args: { p_actor: string; p_version: string; p_minutes: number; p_edits: number; p_note: string | null }; Returns: string }
      reject_talent_version: { Args: { p_actor: string; p_version: string; p_reason: string }; Returns: string }
      unpublish_talent_profile: { Args: { p_actor: string; p_profile: string; p_reason: string }; Returns: string }
      search_talent_profiles: { Args: { p_q: string; p_tag: string; p_area: string }; Returns: ProfileSearchRow[] }
      claim_interview_turn: {
        Args: { p_id: string; p_expected_count: number; p_token: string; p_message_id: string; p_content: string }
        Returns: boolean
      }
      finish_interview_turn: {
        Args: { p_id: string; p_token: string; p_content: string; p_run_id: string; p_collected: Json; p_sufficiency: Json; p_done: boolean }
        Returns: boolean
      }
    }
  }
}
export type ApiUsageInsert = Phase1Tables['api_usage']['Insert']

export type PublicScope = 'public' | 'registered_only' | 'private'
export type ProfileField = { state: CollectedField['state']; value: string | null; evidence: string[]; source: 'interview' | 'owner' }
export type ProfileFields = Record<string, ProfileField>
export type TalentProfile = { id: string; subject_id: string; member_id: string; current_version_id: string | null; draft_version_id: string | null; public_scope: PublicScope; created_at: string; updated_at: string }
export type ProfileVersion = { id: string; profile_id: string; version: number; status: 'draft' | 'owner_reviewed' | 'approved' | 'published' | 'retired'; fields_json: ProfileFields; summary_short: string | null; summary_long: string | null; generated_run_id: string | null; edited_by_owner_at: string | null; owner_approved_at: string | null; admin_approved_by: string | null; admin_approved_at: string | null; rejected_reason: string | null; created_at: string; updated_at: string; public_scope: PublicScope; suggested_tags: string[] }
export type TalentTag = { id: string; slug: string; label: string; kind: 'skill' | 'field' | 'target' | 'area' | 'style'; created_at: string }
export type VersionTag = { version_id: string; tag_id: string; source: 'ai' | 'owner' }
export type Publication = { id: string; profile_id: string; version_id: string; scope: PublicScope; owner_approved_at: string; admin_approved_by: string; admin_approved_at: string; published_at: string; unpublished_at: string | null; reason: string | null; created_at: string }
export type ProfileSearchRow = { profile_id: string; subject_id: string; member_id: string; version_id: string; display_name: string; summary_short: string | null; summary_long: string | null; fields_json: ProfileFields; tags: TalentTag[] }
