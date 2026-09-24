-- SNS巡回で集めた投稿から AI が読み取った「通れた／通れない／解除」の通行情報。
-- 未確認情報として地図に出す（確度 high だけ一般公開・運営は伏せられる）。2026-09-25 事業主決定A。

create table if not exists public.disaster_sns_road_reports (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.disaster_sns_candidates(id) on delete cascade,
  platform text not null,
  permalink text not null,
  posted_at timestamptz not null,
  observed_at timestamptz,
  kind text not null check (kind in ('passed', 'blocked', 'cleared')),
  location_name text not null,
  location_basis text not null default '',
  latitude double precision not null,
  longitude double precision not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  summary text not null default '',
  quote text not null default '',
  hidden boolean not null default false,
  model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_disaster_sns_road_reports_posted_at
  on public.disaster_sns_road_reports (posted_at desc);

-- AI に渡した候補の記録。通行情報でなかった投稿も残し、同じ投稿を二度読まない
create table if not exists public.disaster_sns_road_scans (
  candidate_id uuid primary key references public.disaster_sns_candidates(id) on delete cascade,
  result text not null check (result in ('report', 'none', 'no_location', 'error')),
  detail text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.disaster_sns_road_reports enable row level security;
alter table public.disaster_sns_road_scans enable row level security;
-- 読み書きは service role（API）だけ。anon/authenticated 向けのポリシーは作らない

comment on table public.disaster_sns_road_reports is 'SNS投稿からAIが読み取った通行情報（未確認）。confidence=high かつ hidden=false だけ一般公開';
comment on table public.disaster_sns_road_scans is 'AI判定済みの候補（再判定防止・トークン記録）';
