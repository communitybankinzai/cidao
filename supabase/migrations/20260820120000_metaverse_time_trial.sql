-- メタバース印西 文化財タイムトライアル（厳密計測モード）
-- スタート/通過/ゴールをサーバー受信時刻で記録し、タイムはサーバー時計で確定する。
-- 読み書きは API（service_role）経由のみ。anon には公開しない。
create table if not exists public.metaverse_tt_trials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 20),
  age_key text not null,
  course_key text not null,
  checkpoints_total int not null,
  checkpoints_passed int not null default 0,
  quiz_rate_pct int not null,
  quiz_answers int not null,
  started_at timestamptz not null default now(),
  last_checkpoint_at timestamptz,
  finished_at timestamptz,
  elapsed_ms bigint,
  record_code text,
  status text not null default 'running',  -- running / finished / flagged
  flags text[] not null default '{}',
  client_ip text,
  created_at timestamptz not null default now()
);

alter table public.metaverse_tt_trials enable row level security;
-- ポリシーは作らない（anon/authenticated は一切アクセス不可。service_role はRLSを通過する）
grant all on table public.metaverse_tt_trials to service_role;

create index if not exists idx_mtt_ranking
  on public.metaverse_tt_trials (course_key, elapsed_ms)
  where status = 'finished';
