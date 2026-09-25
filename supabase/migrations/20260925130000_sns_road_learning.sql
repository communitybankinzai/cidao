-- SNS通行情報の「学習」（2026-09-25 事業主決定B）。
-- 1) disaster_sns_places：覚えた地点。OpenStreetMap から取った国道464号沿いの地点と、運営が地図で置き直したときの地名。
--    次から同じ地名の投稿はここから場所が決まる
-- 2) disaster_sns_road_feedback：運営の修正（置き直し・伏せる／戻す と理由）。似た投稿を AI に掛けるとき「過去の判断例」として添える
-- 3) disaster_sns_road_reports.path：「A〜B」のような区間を、道路の形に沿った線（[[lat,lng],...]）で持つ

create table if not exists public.disaster_sns_places (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  lat double precision not null,
  lng double precision not null,
  road_ref text not null default '',
  kind text not null default '',
  source text not null check (source in ('osm', 'moderator')),
  basis text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.disaster_sns_road_feedback (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.disaster_sns_road_reports(id) on delete set null,
  candidate_id uuid,
  action text not null check (action in ('hide', 'unhide', 'move')),
  reason text not null default '',
  place_name text not null default '',
  lat double precision,
  lng double precision,
  kind text not null default '',
  body_excerpt text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_disaster_sns_road_feedback_created on public.disaster_sns_road_feedback (created_at desc);

alter table public.disaster_sns_road_reports add column if not exists path jsonb;
alter table public.disaster_sns_road_reports add column if not exists section_label text not null default '';

alter table public.disaster_sns_places enable row level security;
alter table public.disaster_sns_road_feedback enable row level security;
-- 読み書きは service role（API）だけ。anon/authenticated 向けのポリシーは作らない
grant all on public.disaster_sns_places to service_role;
grant all on public.disaster_sns_road_feedback to service_role;
