-- 防災MAP「通れた道」に「通れない（冠水で止まった地点）」を同居させる。
-- kind='blocked' は path が1点（現在地）。みんつく千葉冠水マップと重なりうるが、
-- 先方への提供（GeoJSON）はこのテーブルから出す。

alter table public.disaster_passed_roads
  add column if not exists kind text not null default 'passed'
    check (kind in ('passed', 'blocked'));

create index if not exists idx_disaster_passed_roads_kind_created
  on public.disaster_passed_roads (kind, created_at desc);

comment on column public.disaster_passed_roads.kind is
  'passed=通れた道（軌跡）／blocked=通れない地点（冠水で止まった現在地・1点）';
