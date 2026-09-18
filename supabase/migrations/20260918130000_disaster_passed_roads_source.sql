-- 記録の由来。gps=スマホの位置情報で現地から／map=地図を長押しして後から指定
alter table public.disaster_passed_roads
  add column if not exists source text not null default 'gps'
    check (source in ('gps', 'map'));

comment on column public.disaster_passed_roads.source is
  'gps=現地でGPS記録／map=地図の長押しで後から指定（時刻は利用者申告）';
