-- サイト全体のページ閲覧記録（PV / VV）
--
-- 目的: どのページがどれだけ見られているかを管理画面で横断的に把握し、
--       増減の分析（前週比など）につなげる。
--
-- event_views（イベント詳細専用）の方針をサイト全体に一般化したもの:
--   - 生ログは誰にも読ませない（select ポリシーを作らない）。集計は関数経由でのみ取得する
--   - 記録はサーバ側（service role）からのみ行うため insert ポリシーも作らない
--   - visitor_key は端末で生成した乱数をサーバ側でハッシュ化した値。IP・UA は保存しない
--   - path は動的セグメントを [id] に正規化したルートパターン（例: /events/[id]）。
--     個別イベントの内訳は既存の event_views が担う
--   - 対象は公開ページのみ（/admin・/me 系・/notifications 等はクライアント側で除外）

create table if not exists public.page_views (
  id          bigserial primary key,
  path        text not null,                                   -- 正規化済みルートパターン
  visitor_key text not null,                                   -- 端末ごとの匿名ID（ハッシュ済・サイト共通）
  member_id   uuid references public.members(id) on delete set null,
  viewed_on   date not null,                                   -- JST の日付。日次集計用
  viewed_at   timestamptz not null default now()
);

create index if not exists idx_page_views_day
  on public.page_views(viewed_on);
create index if not exists idx_page_views_path_day
  on public.page_views(path, viewed_on);

alter table public.page_views enable row level security;
-- ポリシーは意図的に作らない（anon / authenticated からは読み書きとも不可）

-- 日別のサイト全体 PV / VV。管理者のみ結果を返す（権限がなければ0行）。
create or replace function public.page_view_daily(p_days int default 30)
returns table (day date, pv bigint, vv bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if not coalesce(public.is_admin(), false) then
    return;
  end if;

  return query
  select
    v.viewed_on,
    count(*),
    count(distinct v.visitor_key)
  from public.page_views v
  where v.viewed_on > v_today - p_days
  group by v.viewed_on
  order by v.viewed_on;
end;
$$;

-- ページ別の PV / VV（直近 p_days 日）と、その前の同じ長さの期間（前週比用）。
-- 管理者のみ結果を返す（権限がなければ0行）。
create or replace function public.page_view_by_path(p_days int default 7)
returns table (path text, pv bigint, vv bigint, prev_pv bigint, prev_vv bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if not coalesce(public.is_admin(), false) then
    return;
  end if;

  return query
  select
    v.path,
    count(*) filter (where v.viewed_on > v_today - p_days),
    count(distinct v.visitor_key) filter (where v.viewed_on > v_today - p_days),
    count(*) filter (where v.viewed_on <= v_today - p_days),
    count(distinct v.visitor_key) filter (where v.viewed_on <= v_today - p_days)
  from public.page_views v
  where v.viewed_on > v_today - (p_days * 2)
  group by v.path
  order by 2 desc;
end;
$$;

grant execute on function public.page_view_daily(int) to authenticated;
grant execute on function public.page_view_by_path(int) to authenticated;
