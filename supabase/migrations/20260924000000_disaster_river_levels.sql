-- 防災MAP「🌊 水位」の履歴（2026-09-24）。
-- 千葉県の水位ページは直近ぶんしか出さないため、見たときに通り過ぎた値は二度と取れない。
-- 台風25号で「排水量は分かっても、そのとき水位がどう動いたか」を後から確かめられなかったので、
-- /api/disaster/river-level が取得したついでに10分値をここへ貯める（新しい定期実行は作らない＝Vercel の呼び出しを増やさない）。
-- 用途：水位の下がり方 × 排水機場の排水量（国交省・水資源機構の発表）から、沼への流入量を見積もる。
-- 書き込みは Vercel（service_role）のみ。anon / authenticated 向けポリシーは作らない。

create table if not exists public.disaster_river_levels (
  station_id text not null,                      -- teganuma / nishi-inba / kita-inba（route.ts の STATIONS.id）
  observed_at timestamptz not null,              -- 県の観測時刻（10分ごと）
  level numeric(6, 2) not null,                  -- 水位 m（0以下・欠測は保存しない）
  created_at timestamptz not null default now(),
  primary key (station_id, observed_at)          -- 同じ観測値を何度読んでも1行（重複を無視できる）
);

create index if not exists disaster_river_levels_observed_idx
  on public.disaster_river_levels (observed_at desc);

alter table public.disaster_river_levels enable row level security;

grant select on public.disaster_river_levels to service_role;
grant insert on public.disaster_river_levels to service_role;

comment on table public.disaster_river_levels is
  '千葉県の水位（手賀沼・西印旛沼・北印旛沼）の10分値。CBIが読み取って保存。出典：千葉県 水防情報';
