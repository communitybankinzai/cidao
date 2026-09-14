-- AIインタビュー型人材バンク Phase 1。適用は別途承認後に行う。
-- 会話テーブル・保存期間の cron・公開機能・レンダラーは後続フェーズ。
create table if not exists public.talent_subjects (
  id uuid primary key default gen_random_uuid(),
  owner_member_id uuid not null references public.members(id),
  subject_type text not null check (subject_type in ('person', 'shop', 'org')),
  organization_id uuid references public.organizations(id),
  display_name text not null,
  is_adult_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists talent_subjects_one_self
  on public.talent_subjects (owner_member_id) where subject_type = 'person';
comment on table public.talent_subjects is '人材バンクの紹介対象。店舗・団体は代表者本人が操作。代理登録は対象外。';
comment on column public.talent_subjects.is_adult_confirmed is '18歳以上の本人確認。false は準備中でありインタビュー受付を許可しない。受付判定は Phase 2。';

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  subject_id uuid references public.talent_subjects(id),
  kind text not null check (kind in ('interview','profile','photo','video','sns','bank','matching','external_ai')),
  text_version text not null,
  text_hash text not null,
  agreed_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip_hash text,
  check (revoked_at is null or revoked_at >= agreed_at)
);
create index if not exists consents_active_lookup on public.consents (member_id, kind, text_version, subject_id)
  where revoked_at is null;
comment on table public.consents is '用途・対象・文面の版ごとの同意履歴。撤回以外は変更せず、再同意は新規行。';
comment on column public.consents.text_hash is 'UTF-8 同意本文の SHA-256。IP・会話原文は保存しない。';

create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique,
  case_id uuid,
  subject_id uuid references public.talent_subjects(id),
  member_id uuid references public.members(id),
  provider text not null,
  model text not null,
  purpose text not null,
  input_tokens int check (input_tokens >= 0),
  output_tokens int check (output_tokens >= 0),
  cache_creation_tokens int check (cache_creation_tokens >= 0),
  cache_read_tokens int check (cache_read_tokens >= 0),
  audio_seconds numeric check (audio_seconds >= 0),
  tts_chars int check (tts_chars >= 0),
  render_seconds numeric check (render_seconds >= 0),
  storage_bytes bigint check (storage_bytes >= 0),
  image_count int check (image_count >= 0),
  rate_version text,
  currency text not null default 'USD',
  fx_rate numeric check (fx_rate > 0),
  est_cost_usd numeric check (est_cost_usd >= 0),
  est_cost_jpy numeric check (est_cost_jpy >= 0),
  status text not null check (status in ('estimated','unavailable','reconciled')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_case_created on public.api_usage (case_id, created_at);
comment on table public.api_usage is 'service_role が記録するAPI実測利用量と推定費。本文・連絡先・生エラーは保存禁止。運営のみ閲覧。';
comment on column public.api_usage.run_id is 'ラッパー呼び出し単位の UUID。SDK 内部リトライの個別請求はこの表だけでは確定できない。';
comment on column public.api_usage.status is 'estimated=DB単価による推定、unavailable=usage/単価等が未確定、reconciled=将来の請求照合済み。Phase 1 は前二者のみ記録。';
comment on column public.api_usage.est_cost_usd is '推定 USD。請求確定費ではない。usage・単価不明時は NULL とし 0 にしない。請求照合・確定費の格納は後続フェーズ。';
comment on column public.api_usage.rate_version is '使用単価の provider/model/unit@effective_from をセミコロンで連結したスナップショット識別子。';
comment on column public.api_usage.render_seconds is 'Phase 1 では TTS 処理全体の経過秒。audio_seconds は生成 WAV の再生秒数。';

create table if not exists public.cost_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  unit text not null check (unit in ('input_tokens','output_tokens','cache_creation_tokens','cache_read_tokens','tts_chars','image')),
  rate_per_unit numeric not null check (rate_per_unit >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  effective_from date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (provider, model, unit, effective_from)
);
comment on table public.cost_rates is 'USD の1単位あたり料金。改定時は有効日を変えて追加し、過去の単価を上書きしない。';

create table if not exists public.tts_voices (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  voice_id text not null,
  display_name text not null,
  credit_text text not null,
  commercial_ok boolean not null default false,
  terms_url text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, voice_id)
);
create unique index if not exists tts_voices_one_default on public.tts_voices (provider) where is_default;
comment on table public.tts_voices is 'TTS話者設定。クレジットは動画終了カードとSNS文に必須（Phase 4以降）。';
comment on column public.tts_voices.terms_url is '複数の利用規約URLは改行区切りで保持する。';
comment on column public.tts_voices.voice_id is 'VOICEVOX ENGINE の speaker ID。初期値3（ずんだもん・ノーマル）は ENGINE 0.25.2 同梱 model/0.vvm の metas.json で確認。';

create table if not exists public.work_logs (
  id uuid primary key default gen_random_uuid(),
  actor_member_id uuid not null references public.members(id),
  case_id uuid,
  subject_id uuid references public.talent_subjects(id),
  kind text not null check (kind in ('profile_review','text_edit','video_review','video_edit','inquiry_support','ops','illustration')),
  started_at timestamptz not null,
  ended_at timestamptz,
  minutes int check (minutes >= 0),
  edit_count int not null default 0 check (edit_count >= 0),
  note text,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
comment on table public.work_logs is '運営作業の実測時間・修正回数。操作UI・原価集計は後続フェーズ。note に会話や連絡先を含めない。';

alter table public.talent_subjects enable row level security;
alter table public.consents enable row level security;
alter table public.api_usage enable row level security;
alter table public.cost_rates enable row level security;
alter table public.tts_voices enable row level security;
alter table public.work_logs enable row level security;

-- 既存 default privileges は広いので、この6テーブルだけ明示的に取り消す。
revoke all on public.talent_subjects, public.consents, public.api_usage, public.cost_rates, public.tts_voices, public.work_logs from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant all on public.talent_subjects, public.consents, public.api_usage, public.cost_rates, public.tts_voices, public.work_logs to service_role;
grant select, insert, update on public.talent_subjects to authenticated;
grant select, insert on public.consents to authenticated;
grant update (revoked_at) on public.consents to authenticated;
grant select on public.api_usage, public.cost_rates, public.tts_voices to authenticated;
grant select, insert, update, delete on public.work_logs to authenticated;

DO $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='talent_subjects' and policyname='talent_subjects_select') then
    create policy talent_subjects_select on public.talent_subjects for select to authenticated using (owner_member_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='talent_subjects' and policyname='talent_subjects_insert') then
    create policy talent_subjects_insert on public.talent_subjects for insert to authenticated with check (owner_member_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='talent_subjects' and policyname='talent_subjects_update') then
    create policy talent_subjects_update on public.talent_subjects for update to authenticated using (owner_member_id = auth.uid()) with check (owner_member_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='consents' and policyname='consents_select') then
    create policy consents_select on public.consents for select to authenticated using (member_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='consents' and policyname='consents_insert') then
    create policy consents_insert on public.consents for insert to authenticated with check (
      member_id = auth.uid() and revoked_at is null and
      (subject_id is null or exists (select 1 from public.talent_subjects s where s.id = subject_id and s.owner_member_id = auth.uid()))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='consents' and policyname='consents_revoke') then
    create policy consents_revoke on public.consents for update to authenticated using (member_id = auth.uid() and revoked_at is null) with check (member_id = auth.uid() and revoked_at is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='api_usage' and policyname='api_usage_select_admin') then
    create policy api_usage_select_admin on public.api_usage for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='cost_rates' and policyname='cost_rates_select_admin') then
    create policy cost_rates_select_admin on public.cost_rates for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tts_voices' and policyname='tts_voices_select') then
    create policy tts_voices_select on public.tts_voices for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='work_logs' and policyname='work_logs_admin') then
    create policy work_logs_admin on public.work_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end;
$$;

create or replace function public.talent_bank_touch_subject()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create or replace function public.talent_bank_consent_revoke_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at')
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'Consent updates may only revoke an active consent';
  end if;
  return new;
end;
$$;
revoke all on function public.talent_bank_touch_subject(), public.talent_bank_consent_revoke_only() from public, anon, authenticated;
grant execute on function public.talent_bank_touch_subject(), public.talent_bank_consent_revoke_only() to service_role;
DO $$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.talent_subjects'::regclass and tgname='talent_bank_touch_subject') then
    create trigger talent_bank_touch_subject before update on public.talent_subjects for each row execute function public.talent_bank_touch_subject();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.consents'::regclass and tgname='talent_bank_consent_revoke_only') then
    create trigger talent_bank_consent_revoke_only before update on public.consents for each row execute function public.talent_bank_consent_revoke_only();
  end if;
end;
$$;

insert into public.cost_rates (provider, model, unit, rate_per_unit, currency, effective_from, note) values
  ('anthropic','claude-sonnet-5','input_tokens',0.000002,'USD','2026-09-14','統合仕様v1 初期単価（1 tokenあたり）'),
  ('anthropic','claude-sonnet-5','output_tokens',0.000010,'USD','2026-09-14','統合仕様v1 初期単価'),
  ('anthropic','claude-sonnet-5','cache_creation_tokens',0.00000250,'USD','2026-09-14','ephemeral 5分キャッシュ'),
  ('anthropic','claude-sonnet-5','cache_read_tokens',0.00000020,'USD','2026-09-14','統合仕様v1 初期単価'),
  ('anthropic','claude-opus-5','input_tokens',0.000005,'USD','2026-09-14','統合仕様v1 初期単価（1 tokenあたり）'),
  ('anthropic','claude-opus-5','output_tokens',0.000025,'USD','2026-09-14','統合仕様v1 初期単価'),
  ('anthropic','claude-opus-5','cache_creation_tokens',0.00000625,'USD','2026-09-14','ephemeral 5分キャッシュ'),
  ('anthropic','claude-opus-5','cache_read_tokens',0.00000050,'USD','2026-09-14','統合仕様v1 初期単価'),
  ('voicevox','*','tts_chars',0,'USD','2026-09-14','無料。speaker ID 3 は ENGINE 0.25.2 同梱 model/0.vvm の metas.json で確認')
on conflict (provider, model, unit, effective_from) do nothing;

insert into public.tts_voices (provider, voice_id, display_name, credit_text, commercial_ok, terms_url, is_default) values
  ('voicevox','3','ずんだもん（ノーマル）','VOICEVOX:ずんだもん',true,
   E'https://voicevox.hiroshiba.jp/term/\nhttps://zunko.jp/con_ongen_kiyaku.html',true)
on conflict (provider, voice_id) do nothing;

insert into public.app_settings (key, value) values ('usd_jpy', '150'::jsonb)
on conflict (key) do nothing;
