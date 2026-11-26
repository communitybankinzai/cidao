-- 雨雲レーダーの雨の強さを、印西周辺の約1kmごとに貯める（2026-11-26）
--
-- 気象庁の雨雲レーダー（高解像度降水ナウキャスト hrpns）は過去3時間ぶんしか残らない。
-- アメダスは印西市内に無く、10〜20km離れた4地点の平均では局地的な大雨を拾えないため、
-- レーダーの画像の色を雨の強さの区分に戻して、10分ごとに控えておく。
--
-- 取り込みは /api/disaster/rain-archive（pg_cron が毎時呼ぶ）。
-- ⚠ 値は色の区分（8段階）の代表値で、正確な雨量ではない。区分そのもの（cells の値）を正とする。
create table if not exists public.disaster_radar_rain (
  observed_at  timestamptz not null primary key,
  -- 雨の降っていた升目だけ {"行,列": 区分(1〜8)}。升目は radar_grid の決め方（下のコメント）
  cells        jsonb       not null default '{}'::jsonb,
  wet_cells    integer     not null default 0,   -- 雨の降っていた升目の数
  max_class    integer     not null default 0,   -- いちばん強い区分（0＝どこも降っていない）
  grid         text        not null,             -- 升目の決め方の版（例 inzai-0.01deg-v1）
  created_at   timestamptz not null default now()
);

comment on table public.disaster_radar_rain is
  '気象庁 雨雲レーダー（hrpns）の色を区分に戻した控え。区分 1:1mm/h未満 2:1-5 3:5-10 4:10-20 5:20-30 6:30-50 7:50-80 8:80以上。升目は北緯35.70〜35.92・東経140.00〜140.36 を0.01度ごと（行=緯度の北から・列=経度の西から）';

create index if not exists disaster_radar_rain_observed_idx
  on public.disaster_radar_rain (observed_at desc);

alter table public.disaster_radar_rain enable row level security;

-- 2026-10-30 以降の新しい表は Data API の権限が自動で付かない。読み書きは service_role だけ（API を通して読む）
revoke all on public.disaster_radar_rain from anon, authenticated;
grant select, insert, update, delete on public.disaster_radar_rain to service_role;
