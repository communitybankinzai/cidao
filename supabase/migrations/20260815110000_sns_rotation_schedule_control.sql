-- =============================================================
-- SNS 定期紹介の実行間隔を管理画面から変更できるようにする
--
-- 背景: ローテーションは pg_cron ジョブ（cidao_sns_rotation）で固定の
--       「毎日 JST 9時」だった。団体候補を登録完了・更新済みに限定した結果
--       候補が24件規模になり、一巡が早すぎる場合に間隔を広げたい。
--
-- 設計:
--   ・自由な cron 式は受け付けず、プリセット（daily / every2days /
--     weekly / monthly / off）だけを許可する（誤設定防止）
--   ・cron スキーマはアプリのセッションから触れないため
--     security definer 関数経由で読み書きする。実行は管理者のみ
-- =============================================================

-- 現在の実行間隔を返す（管理者のみ）
create or replace function public.get_sns_rotation_schedule()
returns table (schedule text, active boolean)
language plpgsql security definer set search_path = public, cron
as $$
begin
  if not public.is_admin() then
    raise exception '管理者権限が必要です';
  end if;
  return query
    select j.schedule::text, j.active
      from cron.job j
     where j.jobname = 'cidao_sns_rotation';
end;
$$;

-- 実行間隔をプリセットで変更する（管理者のみ）
--   daily      … 毎日   JST 9時（0 0 * * *）
--   every2days … 隔日   JST 9時（0 0 */2 * *）
--   weekly     … 毎週月曜 JST 9時（0 0 * * 1）
--   monthly    … 毎月1日 JST 9時（0 0 1 * *）
--   off        … 停止（ジョブ削除。手動「今すぐ実行」は引き続き使える）
create or replace function public.set_sns_rotation_schedule(p_preset text)
returns text
language plpgsql security definer set search_path = public, cron
as $$
declare
  v_expr text;
  v_jobid bigint;
begin
  if not public.is_admin() then
    raise exception '管理者権限が必要です';
  end if;

  v_expr := case p_preset
    when 'daily'      then '0 0 * * *'
    when 'every2days' then '0 0 */2 * *'
    when 'weekly'     then '0 0 * * 1'
    when 'monthly'    then '0 0 1 * *'
    when 'off'        then null
    else null
  end;
  if p_preset <> 'off' and v_expr is null then
    raise exception '不正なプリセットです: %', p_preset;
  end if;

  select jobid into v_jobid from cron.job where jobname = 'cidao_sns_rotation';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  if p_preset = 'off' then
    return 'off';
  end if;

  perform cron.schedule(
    'cidao_sns_rotation',
    v_expr,
    $job$select public.run_sns_rotation_cycle(1);$job$
  );
  return v_expr;
end;
$$;

grant execute on function public.get_sns_rotation_schedule() to authenticated;
grant execute on function public.set_sns_rotation_schedule(text) to authenticated;
