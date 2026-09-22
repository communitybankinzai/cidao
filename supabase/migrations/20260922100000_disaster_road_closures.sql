-- 防災MAP「🚧 通行止め（役所の発表）」。
-- 役所の公式ページ（千葉国道事務所の記者発表・千葉県の県管理道路通行規制・印西市の通行止め記事）を
-- 災害タイムラインの巡回（disaster_info_sources の kind road-closure-*）が読み、記事ごとに1行を持つ。
-- 解除は自動：役所が解除を発表した（announced）／見張るページから消えた（disappeared）。
-- 役所の文章は写さず、路線名・場所・理由という事実だけを持つ（各サイトの規約が無断転用を認めないため）。
-- 地図に線を引くのは運営が位置を確かめた行だけ（path）。それ以外は一覧に文字で出す。
-- 書き込みは Vercel（service_role）のみ。anon / authenticated 向けポリシーは作らない。

create table if not exists public.disaster_road_closures (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.disaster_info_sources(id) on delete cascade,
  closure_key text not null,                     -- 情報源の中で1件を見分ける鍵（路線＋区間、記事URLなど）
  road text not null default '',                 -- 例: 国道16号／市道師戸・江川線
  place text not null default '',                -- 例: 村田町アンダーパス／一部区間
  reason text not null default '',               -- 例: 大雨／道路冠水
  municipality text not null default '',         -- 分かるときだけ（例: 印西市）
  in_area boolean not null default true,         -- 印西市とその周辺（config で決める）なら true。画面は true だけ出す
  url text,                                      -- 出典（役所の記事・資料）
  source_title text not null default '',         -- 役所の題名（判定の確認用。画面には出さない）
  published_at timestamptz,                      -- 役所の発表日時（分からなければ null）
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  cleared_at timestamptz,                        -- null＝通行止め中
  clear_reason text check (clear_reason in ('announced', 'disappeared', 'operator')),
  path jsonb,                                    -- 運営が位置を確かめた線 [[lat, lon], ...]（null＝線なし）
  path_checked_by text,
  path_checked_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, closure_key)
);

create index if not exists idx_disaster_road_closures_active
  on public.disaster_road_closures (cleared_at, in_area);

comment on table public.disaster_road_closures is
  '防災MAPの通行止め（役所の発表）。巡回が記事ごとに1行を持ち、解除の発表か掲載終了で cleared_at を入れる。path は運営が位置を確かめた線だけ。';

alter table public.disaster_road_closures enable row level security;

revoke all on public.disaster_road_closures from anon, authenticated;
grant all on table public.disaster_road_closures to service_role;
