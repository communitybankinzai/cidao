-- イベントページの閲覧記録（PV / VV）
--
-- 目的: SNS（Threads / Instagram）からの流入がどれだけ実際の閲覧につながったかを、
--       主催者と運営が把握できるようにする。
--
-- PV = 閲覧回数（同じ人が何度開いても加算）
-- VV = 閲覧した端末数（visitor_key の異なり数）
--
-- 方針:
--   - 生ログは誰にも読ませない（select ポリシーを作らない）。集計は関数経由でのみ取得する
--   - 記録はサーバ側（service role）からのみ行うため insert ポリシーも作らない
--   - visitor_key は端末で生成した乱数をサーバ側でハッシュ化した値。個人を特定する情報は持たない

create table if not exists public.event_views (
  id          bigserial primary key,
  event_id    uuid not null references public.events(id) on delete cascade,
  visitor_key text not null,                                   -- 端末ごとの匿名ID（ハッシュ済）
  member_id   uuid references public.members(id) on delete set null,
  viewed_on   date not null,                                   -- JST の日付。当日集計用
  viewed_at   timestamptz not null default now()
);

create index if not exists idx_event_views_event_day
  on public.event_views(event_id, viewed_on);
create index if not exists idx_event_views_event_visitor
  on public.event_views(event_id, visitor_key);

alter table public.event_views enable row level security;
-- ポリシーは意図的に作らない（anon / authenticated からは読み書きとも不可）

-- 集計取得。イベントの主催者、または管理者のみ結果を返す。
-- 権限がなければ0行を返し、呼び出し側は非表示にする。
create or replace function public.event_view_stats(p_event_id uuid)
returns table (pv_today bigint, vv_today bigint, pv_total bigint, vv_total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_today   date := (now() at time zone 'Asia/Tokyo')::date;
begin
  select
    public.is_admin()
    or exists (
      select 1
        from public.events e
       where e.id = p_event_id
         and (
           (e.organizer_type = 'member' and e.organizer_id = auth.uid())
           or (e.organizer_type = 'org' and public.is_org_officer(e.organizer_id))
         )
    )
  into v_allowed;

  if not coalesce(v_allowed, false) then
    return;
  end if;

  return query
  select
    count(*) filter (where v.viewed_on = v_today),
    count(distinct v.visitor_key) filter (where v.viewed_on = v_today),
    count(*),
    count(distinct v.visitor_key)
  from public.event_views v
  where v.event_id = p_event_id;
end;
$$;

grant execute on function public.event_view_stats(uuid) to authenticated;
