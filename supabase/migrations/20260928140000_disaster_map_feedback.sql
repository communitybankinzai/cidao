-- 防災MAPの「💬 要望を送る」。使いながら気づいたこと・ほしい機能を市民が送る（2026-09-28 事業主決定A）。
-- 匿名（端末の乱数IDだけ）。表示中の地図の場所は、送る人が選んだときだけ添える。
-- 書き込みは Vercel の /api/disaster/feedback（service_role）経由のみ。一覧は運営の合言葉があるときだけ返す。

create table if not exists public.disaster_map_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  device_id text not null,                           -- 端末ごとの匿名ID（通れた道の記録と同じ localStorage の値）
  body text not null,                                -- 要望の本文（500字まで・API で検証）
  lat double precision,                              -- 送るときに表示していた地図の中心（任意）
  lon double precision,
  zoom smallint,
  app_version text not null default '',             -- 送ったときの MAP の版（どの画面への要望か）
  status text not null default 'new' check (status in ('new', 'done')), -- done＝運営が読んで対応を決めた
  hidden boolean not null default false,             -- いたずら・個人情報が書かれたものを運営が伏せる（行は消さない）
  ip_hash text not null default ''                   -- 連投制限用。生IPは持たない
);

create index if not exists idx_disaster_map_feedback_created_at
  on public.disaster_map_feedback (created_at desc);
create index if not exists idx_disaster_map_feedback_device
  on public.disaster_map_feedback (device_id, created_at desc);

comment on table public.disaster_map_feedback is
  '防災MAPの利用者からの要望（匿名）。一般には公開しない。status=done は運営が対応を決めたもの、hidden=true は伏せたもの。';

alter table public.disaster_map_feedback enable row level security;

-- サーバー側 service_role 経由のみ。anon / authenticated 向けポリシーは作らない。
revoke all on public.disaster_map_feedback from anon, authenticated;
grant all on table public.disaster_map_feedback to service_role;
