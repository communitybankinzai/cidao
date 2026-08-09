-- =============================================================
-- ページ閲覧の流入元（utm_source）記録
--
-- SNS告知リンクには utm_source=threads 等を付けているが、page_views は
-- プライバシー配慮でクエリ全体を捨てる設計のため媒体別流入が見えなかった。
-- クエリを捨てる設計は維持したまま、utm_source の「既知の媒体名のみ」を
-- ホワイトリスト方式で抽出して別カラムに記録する（サーバ側で検証）。
-- =============================================================

alter table public.page_views
  add column if not exists source text;

comment on column public.page_views.source is
  '流入元（utm_source）。threads/instagram 等の既知の値のみサーバ側で許可して保存。直接訪問は null。';

create index if not exists idx_page_views_source_day
  on public.page_views(source, viewed_on)
  where source is not null;

-- 流入元別 × ページ別の PV / VV（直近 p_days 日）。管理者のみ結果を返す。
create or replace function public.page_view_sources(p_days int default 30)
returns table (source text, path text, pv bigint, vv bigint)
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
    v.source,
    v.path,
    count(*),
    count(distinct v.visitor_key)
  from public.page_views v
  where v.source is not null
    and v.viewed_on > v_today - p_days
  group by v.source, v.path
  order by count(*) desc;
end;
$$;

grant execute on function public.page_view_sources(int) to authenticated;
