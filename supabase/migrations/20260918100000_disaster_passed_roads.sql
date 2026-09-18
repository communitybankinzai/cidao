-- 防災MAP「通れた道」の GPS 軌跡。
-- 閲覧者がスマホの位置情報で「いま通れた道」を記録し、地図に青い線で出す。
-- 冠水時に通れた実績として消さずに残す（6時間以内＝濃い青／それ以前＝薄い青は画面側で判定）。
-- 書き込みは Vercel の /api/disaster/passed-roads（service_role）経由のみ。匿名投稿だが端末IDで投稿間隔を制限する。

create table if not exists public.disaster_passed_roads (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,                           -- 端末ごとの匿名ID（localStorage）。個人は特定しない
  path jsonb not null,                               -- [[lat, lon], ...] 5m〜数十m間隔の軌跡
  point_count integer not null default 0,
  length_m numeric(10, 1) not null default 0,        -- 軌跡の概算距離（m）
  started_at timestamptz not null,                   -- 記録開始（端末時刻）
  ended_at timestamptz not null,                     -- 記録終了（端末時刻）
  note text not null default '',                     -- 任意の一言（「浅い水たまりあり」など、200字まで）
  hidden boolean not null default false,             -- 運営が非表示にした記録（誤情報・いたずら）
  created_at timestamptz not null default now(),
  ip_hash text not null default ''                   -- 投稿間隔制限用。生IPは持たない
);

create index if not exists idx_disaster_passed_roads_created_at
  on public.disaster_passed_roads (created_at desc);
create index if not exists idx_disaster_passed_roads_device
  on public.disaster_passed_roads (device_id, created_at desc);

comment on table public.disaster_passed_roads is
  '防災MAPで閲覧者が GPS で記録した「通れた道」。冠水時に通れた実績として恒久保存。hidden=true は運営が伏せた記録。';

alter table public.disaster_passed_roads enable row level security;

-- サーバー側 service_role 経由のみ。anon / authenticated 向けポリシーは作らない。
revoke all on public.disaster_passed_roads from anon, authenticated;
grant all on table public.disaster_passed_roads to service_role;
