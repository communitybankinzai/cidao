-- 公式発表タイムラインを削除しない（案A・2026-08-23 決定）
-- 理由: 災害の振り返り用途のため。90日削除では令和8年8月千葉豪雨の発表が 2026-11-11 に消えてしまう。
-- 件数は年数百件規模で容量上の問題はない。

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_disaster_timeline_cleanup';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

-- 関数は残すが、呼んでも何も消さない（誤って再スケジュールされても安全）
create or replace function public.cleanup_disaster_timeline_items()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 2026-08-23 案A: タイムラインは永続保存。削除しない。
  return 0;
end;
$$;
