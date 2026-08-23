-- 災害タイムライン（市公式発表・気象庁・市長SNS等）のための情報源レジストリと取得済み項目。
-- 情報源はコードに固定せず、管理画面 /admin/disaster-sources から追加・停止できる。
-- GitHub Pages 側の災害MAPは GET /api/disaster/timeline でこの内容を読む。

create extension if not exists pg_net with schema extensions;

create table if not exists public.disaster_info_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  label text not null,
  url text not null default '',
  config jsonb not null default '{}'::jsonb,
  trust text not null default 'official'
    check (trust in ('official', 'semi-official', 'unverified')),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  last_status text,
  last_error text
);

create table if not exists public.disaster_timeline_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.disaster_info_sources(id) on delete cascade,
  external_key text not null,
  occurred_at timestamptz not null,
  title text not null default '',
  body text not null default '',
  url text,
  area_tag text,
  change_type text not null default 'new'
    check (change_type in ('new', 'update', 'cancel')),
  priority integer not null default 0,
  content_hash text not null default '',
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_key)
);

create index if not exists idx_disaster_timeline_items_occurred_at
  on public.disaster_timeline_items (occurred_at desc);

create table if not exists public.disaster_timeline_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  result jsonb not null default '{}'::jsonb,
  error_message text
);

comment on table public.disaster_info_sources is
  '災害タイムラインの情報源レジストリ。kind ごとのパーサは src/lib/disaster-timeline.ts にある。';
comment on table public.disaster_timeline_items is
  '情報源から取得した発表項目。(source_id, external_key) で重複排除し、content_hash が変わったら update 扱い。';

alter table public.disaster_info_sources enable row level security;
alter table public.disaster_timeline_items enable row level security;
alter table public.disaster_timeline_runs enable row level security;

-- サーバー側 service_role 経由のみ。anon / authenticated 向けポリシーは作らない。
revoke all on public.disaster_info_sources from anon, authenticated;
revoke all on public.disaster_timeline_items from anon, authenticated;
revoke all on public.disaster_timeline_runs from anon, authenticated;
grant all on table public.disaster_info_sources to service_role;
grant all on table public.disaster_timeline_items to service_role;
grant all on table public.disaster_timeline_runs to service_role;

insert into public.disaster_info_sources (kind, label, url, config, trust, sort_order)
select * from (values
  (
    'city-category-html',
    '印西市 防災情報（市公式）',
    'https://www.city.inzai.lg.jp/bousaiportal/category/16-5-2-0-0.html',
    '{"baseUrl":"https://www.city.inzai.lg.jp/bousaiportal/","bodySelector":".mol_contents"}'::jsonb,
    'official',
    10
  ),
  (
    'city-category-html',
    '印西市 避難情報（市公式）',
    'https://www.city.inzai.lg.jp/bousaiportal/category/16-5-1-0-0.html',
    '{"baseUrl":"https://www.city.inzai.lg.jp/bousaiportal/","bodySelector":".mol_contents"}'::jsonb,
    'official',
    20
  ),
  (
    'city-alert-xml',
    '印西市 防災行政無線 放送内容',
    'https://www.city.inzai.lg.jp/bousaiinzai/get_bousai_xml.php',
    '{"baseUrl":"https://www.city.inzai.lg.jp/bousaiinzai/"}'::jsonb,
    'official',
    30
  ),
  (
    'jma-warning',
    '気象庁 印西市の警報・注意報',
    'https://www.jma.go.jp/bosai/warning/data/r8/120000.json',
    '{"areaCode":"1223100"}'::jsonb,
    'official',
    40
  ),
  (
    'jma-overview',
    '気象庁 千葉県 天気概況',
    'https://www.jma.go.jp/bosai/forecast/data/overview_forecast/120000.json',
    '{}'::jsonb,
    'official',
    50
  ),
  (
    'jma-quake',
    '気象庁 地震情報',
    'https://www.jma.go.jp/bosai/quake/data/list.json',
    '{"cityCode":"1223100","detailBase":"https://www.jma.go.jp/bosai/quake/data/"}'::jsonb,
    'official',
    60
  ),
  (
    'sns-priority',
    '市長・市公式SNS投稿',
    '',
    '{}'::jsonb,
    'semi-official',
    70
  )
) as seed(kind, label, url, config, trust, sort_order)
where not exists (
  select 1 from public.disaster_info_sources s
   where s.kind = seed.kind and s.url = seed.url
);

-- 重複実行防止（sns-monitor と同じ app_settings ベースの 4 分クレーム）
insert into public.app_settings (key, value)
values (
  'disaster_timeline_state',
  jsonb_build_object('enabled', true, 'interval_minutes', 10, 'last_started_at', null)
)
on conflict (key) do nothing;

create or replace function public.claim_disaster_timeline_run(p_min_interval_seconds integer default 240)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value jsonb;
  v_last_started timestamptz;
begin
  insert into public.app_settings (key, value)
  values ('disaster_timeline_state', jsonb_build_object('enabled', true, 'interval_minutes', 10))
  on conflict (key) do nothing;

  select value into v_value
    from public.app_settings
   where key = 'disaster_timeline_state'
   for update;

  if coalesce((v_value ->> 'enabled')::boolean, true) is false then
    return false;
  end if;

  v_last_started := nullif(v_value ->> 'last_started_at', '')::timestamptz;
  if v_last_started is not null
     and v_last_started > now() - make_interval(secs => greatest(p_min_interval_seconds, 60)) then
    return false;
  end if;

  update public.app_settings
     set value = coalesce(value, '{}'::jsonb)
       || jsonb_build_object('last_started_at', now(), 'enabled', true),
         updated_at = now()
   where key = 'disaster_timeline_state';
  return true;
end;
$$;

revoke all on function public.claim_disaster_timeline_run(integer) from public, anon, authenticated;
grant execute on function public.claim_disaster_timeline_run(integer) to service_role;

create or replace function public.cleanup_disaster_timeline_items()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.disaster_timeline_items
   where occurred_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_disaster_timeline';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  select jobid into v_jobid from cron.job where jobname = 'cidao_disaster_timeline_cleanup';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

-- 10 分ごとに Vercel 側の巡回 API を叩く（sns-monitor と同じ pg_cron + pg_net 方式）
select cron.schedule(
  'cidao_disaster_timeline',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := 'https://cidao.vercel.app/api/disaster/timeline',
      headers := '{"Content-Type":"application/json","User-Agent":"cidao-supabase-cron/1.0"}'::jsonb,
      body := '{"mode":"scheduled"}'::jsonb,
      timeout_milliseconds := 50000
    );
  $job$
);

select cron.schedule(
  'cidao_disaster_timeline_cleanup',
  '35 18 * * *',
  $$select public.cleanup_disaster_timeline_items();$$
);
