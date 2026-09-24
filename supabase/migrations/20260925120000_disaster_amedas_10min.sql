-- アメダスの10分値を貯める（2026-09-25）
--
-- 気象庁の10分値（bosai/amedas/data/point/<code>/<YYYYMMDD>_<HH>.json）は
-- 約1週間で消える。台風25号のような過去の災害の記録に、あとから雨量を
-- 付けられるようにするため、印旛地区周辺の観測所ぶんを手元に貯めておく。
--
-- 取り込みは Vercel ではなく、PC の定期実行（CBI 直下の scripts/amedas-backup.py）で行う。
-- Vercel の無料枠を使わないため。
create table if not exists public.disaster_amedas_10min (
  station_id   text        not null,
  observed_at  timestamptz not null,
  r10_mm       numeric,
  r1h_mm       numeric,
  r3h_mm       numeric,
  r24h_mm      numeric,
  created_at   timestamptz not null default now(),
  primary key (station_id, observed_at)
);

comment on table public.disaster_amedas_10min is
  'アメダス10分値の控え。気象庁は約1週間で消すため、過去の記録に雨量を付けられるよう貯めている';

create index if not exists disaster_amedas_10min_observed_idx
  on public.disaster_amedas_10min (observed_at desc);

alter table public.disaster_amedas_10min enable row level security;
-- 読み書きは service_role だけ（APIを通して読む）
