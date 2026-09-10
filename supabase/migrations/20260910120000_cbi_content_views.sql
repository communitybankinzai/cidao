create table if not exists public.cbi_content_views (
  id uuid primary key,
  visitor_id uuid not null,
  content text not null check (content in ('world', 'disaster-map')),
  created_at timestamptz not null default now()
);
create index if not exists cbi_content_views_created_idx on public.cbi_content_views(created_at, content);
alter table public.cbi_content_views enable row level security;
revoke all on public.cbi_content_views from anon, authenticated;
grant select, insert on public.cbi_content_views to service_role;

create or replace function public.cbi_content_daily(p_days integer default 30)
returns table(day date, content text, pv bigint, vv bigint, legacy_sessions bigint)
language sql stable security invoker set search_path = public
as $$
  with days as (
    select ((now() at time zone 'Asia/Tokyo')::date - n)::date as day
    from generate_series(0, greatest(1, least(90, p_days)) - 1) n
  ), views as (
    select (created_at at time zone 'Asia/Tokyo')::date as day, content,
      count(*) pv, count(distinct visitor_id) vv
    from public.cbi_content_views
    where created_at >= ((select min(day) from days)::timestamp at time zone 'Asia/Tokyo')
    group by 1, 2
  ), legacy as (
    select day, case when mode = 'disaster-map' then 'disaster-map' else 'world' end content,
      count(distinct session_id) sessions
    from public.metaverse_presence_daily
    where day >= (select min(day) from days)
    group by 1, 2
  )
  select d.day, c.content,
    case when d.day < date '2026-09-10' then null else coalesce(v.pv, 0) end,
    case when d.day < date '2026-09-10' then null else coalesce(v.vv, 0) end,
    coalesce(l.sessions, 0)
  from days d cross join (values ('world'), ('disaster-map')) c(content)
  left join views v on v.day=d.day and v.content=c.content
  left join legacy l on l.day=d.day and l.content=c.content
  order by d.day, c.content;
$$;
revoke all on function public.cbi_content_daily(integer) from public, anon, authenticated;
grant execute on function public.cbi_content_daily(integer) to service_role;
