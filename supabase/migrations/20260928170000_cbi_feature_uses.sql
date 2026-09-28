-- 防災MAP（と3Dワールド）で「どの機能が押されたか」を数える（2026-09-28 事業主決定A：いらない機能を見極めるため）。
-- 1回のページ読み込み＝1行。端末の中で回数をまとめ、ページを閉じるときに送る（同じ view_id は上書き＝回数は増えるだけ）。
-- 個人を表すものは持たない（visitor_id は端末で作った乱数・訪問数と同じもの）。公開するのは集計だけ。90日で消す。
create table if not exists public.cbi_feature_uses (
  view_id uuid primary key,
  visitor_id uuid not null,
  content text not null check (content in ('world', 'disaster-map')),
  device text not null default '' check (device in ('', 'mobile', 'desktop')),
  counts jsonb not null default '{}'::jsonb,
  labels jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cbi_feature_uses_created_idx on public.cbi_feature_uses(created_at, content);
alter table public.cbi_feature_uses enable row level security;
revoke all on public.cbi_feature_uses from anon, authenticated;
grant select, insert, update, delete on public.cbi_feature_uses to service_role;

-- 機能ごとの集計（使った訪問の数・押された回数・うちスマホの訪問）。label は最後に見た表示名
create or replace function public.cbi_feature_ranking(p_days integer default 30, p_content text default 'disaster-map')
returns table(feature text, label text, uses bigint, visits bigint, mobile_visits bigint)
language sql stable security invoker set search_path = public
as $$
  with rows as (
    select * from public.cbi_feature_uses
    where content = p_content
      and created_at >= now() - make_interval(days => greatest(1, least(90, p_days)))
  )
  select e.key as feature,
    (array_agg(r.labels ->> e.key order by r.updated_at desc) filter (where r.labels ? e.key))[1] as label,
    sum(e.value::bigint) as uses,
    count(*) as visits,
    count(*) filter (where r.device = 'mobile') as mobile_visits
  from rows r cross join lateral jsonb_each_text(r.counts) e
  group by e.key
  order by visits desc, uses desc;
$$;
revoke all on function public.cbi_feature_ranking(integer, text) from public, anon, authenticated;
grant execute on function public.cbi_feature_ranking(integer, text) to service_role;

-- 90日を過ぎた行を毎日消す（data.html に書く約束）
select cron.schedule('cbi_feature_uses_cleanup', '23 3 * * *',
  $$delete from public.cbi_feature_uses where created_at < now() - interval '90 days'$$);
