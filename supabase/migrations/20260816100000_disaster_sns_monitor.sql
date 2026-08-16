-- Disaster SNS monitoring for the Inzai disaster map.
-- Discovery candidates are never published automatically. Operators review them first.

create extension if not exists pg_net with schema extensions;

create table if not exists public.disaster_sns_monitor_rules (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('threads', 'instagram', 'bluesky')),
  query text not null,
  enabled boolean not null default true,
  last_scanned_at timestamptz,
  last_status text not null default 'waiting',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, query)
);

create table if not exists public.disaster_sns_candidates (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('threads', 'instagram', 'bluesky')),
  external_id text not null,
  permalink text not null,
  author_username text,
  body_text text not null default '',
  comments_text text not null default '',
  media_url text,
  posted_at timestamptz not null,
  discovered_at timestamptz not null default now(),
  matched_rule_id uuid references public.disaster_sns_monitor_rules(id) on delete set null,
  matched_query text not null default '',
  latitude double precision,
  longitude double precision,
  location_name text,
  review_status text not null default 'new'
    check (review_status in ('new', 'reviewing', 'accepted', 'dismissed')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);

create index if not exists idx_disaster_sns_candidates_posted_at
  on public.disaster_sns_candidates (posted_at desc);
create index if not exists idx_disaster_sns_candidates_review
  on public.disaster_sns_candidates (review_status, discovered_at desc);

create table if not exists public.disaster_sns_scan_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  discovered_count integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  error_message text
);

comment on table public.disaster_sns_candidates is
  'Public SNS discovery candidates. A candidate must be reviewed before it is copied to the disaster map.';

alter table public.disaster_sns_monitor_rules enable row level security;
alter table public.disaster_sns_candidates enable row level security;
alter table public.disaster_sns_scan_runs enable row level security;

-- These tables are accessed only through server-side service_role APIs.
revoke all on public.disaster_sns_monitor_rules from anon, authenticated;
revoke all on public.disaster_sns_candidates from anon, authenticated;
revoke all on public.disaster_sns_scan_runs from anon, authenticated;

insert into public.disaster_sns_monitor_rules (platform, query, enabled)
values
  ('threads', '印西市', true),
  ('threads', '千葉ニュータウン', true),
  ('threads', '木下', true),
  ('bluesky', '印西市', true),
  ('bluesky', '千葉ニュータウン', true),
  ('bluesky', '木下', true),
  ('instagram', '印西市', true),
  ('instagram', '印西市冠水', true)
on conflict (platform, query) do nothing;

insert into public.app_settings (key, value)
values (
  'disaster_sns_monitor_state',
  jsonb_build_object('enabled', true, 'interval_minutes', 5, 'last_started_at', null)
)
on conflict (key) do nothing;

create or replace function public.claim_disaster_sns_scan(p_min_interval_seconds integer default 240)
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
  values ('disaster_sns_monitor_state', jsonb_build_object('enabled', true, 'interval_minutes', 5))
  on conflict (key) do nothing;

  select value into v_value
    from public.app_settings
   where key = 'disaster_sns_monitor_state'
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
   where key = 'disaster_sns_monitor_state';
  return true;
end;
$$;

revoke all on function public.claim_disaster_sns_scan(integer) from public, anon, authenticated;
grant execute on function public.claim_disaster_sns_scan(integer) to service_role;

create or replace function public.cleanup_disaster_sns_candidates()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.disaster_sns_candidates
   where (review_status = 'dismissed' and updated_at < now() - interval '30 days')
      or (review_status in ('new', 'reviewing') and posted_at < now() - interval '90 days');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_disaster_sns_monitor';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  select jobid into v_jobid from cron.job where jobname = 'cidao_disaster_sns_cleanup';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

-- Supabase pg_cron provides the five-minute scheduler without requiring Vercel Pro.
select cron.schedule(
  'cidao_disaster_sns_monitor',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://cidao.vercel.app/api/disaster/sns-monitor',
      headers := '{"Content-Type":"application/json","User-Agent":"cidao-supabase-cron/1.0"}'::jsonb,
      body := '{"mode":"scheduled"}'::jsonb,
      timeout_milliseconds := 50000
    );
  $job$
);

select cron.schedule(
  'cidao_disaster_sns_cleanup',
  '25 18 * * *',
  $$select public.cleanup_disaster_sns_candidates();$$
);
