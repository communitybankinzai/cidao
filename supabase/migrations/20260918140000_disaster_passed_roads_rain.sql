-- 記録時刻の最寄りアメダス（我孫子・佐倉・成田・船橋）の雨量を添えて、
-- 「冠水による通れない」か「工事・事故など別の理由」かの目安を出す。
alter table public.disaster_passed_roads
  add column if not exists rain_station text not null default '',
  add column if not exists rain_at timestamptz,
  add column if not exists rain_1h_mm numeric(6, 1),
  add column if not exists rain_3h_mm numeric(6, 1),
  add column if not exists rain_24h_mm numeric(6, 1),
  add column if not exists rain_verdict text not null default 'unknown'
    check (rain_verdict in ('flood_likely', 'light_rain', 'no_rain', 'unknown'));

comment on column public.disaster_passed_roads.rain_verdict is
  'flood_likely=雨あり（1h>=5 or 3h>=10 or 24h>=30mm）／light_rain=少雨／no_rain=雨なし（工事など別の理由の可能性）／unknown=取得失敗';
