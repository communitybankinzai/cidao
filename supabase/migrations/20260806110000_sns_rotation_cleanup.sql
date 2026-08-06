-- =============================================================
-- SNS 定期紹介の生成媒体見直し＋古い未承認下書きの自動掃除
--
-- 背景: 日次ローテーションが未接続媒体（X/Facebook/LINE）向けの下書きを
--       毎日3件ずつ作り続け、承認待ちが98件規模に膨張していた（2026-08-06時点）。
--       配信できるのは接続済みの Threads のみ（Instagram は画像必須のため
--       提案告知専用で、ローテーション紹介では配信できない）。
-- =============================================================

-- 1. ローテーションの生成媒体デフォルトを Threads のみに変更。
--    pg_cron ジョブ（cidao_sns_rotation）は run_sns_rotation_cycle(1) と
--    デフォルト引数で呼んでいるため、関数の再定義だけで反映される。
--    LINE / Facebook が接続されたら enabled_media に追加すること。
drop function if exists public.run_sns_rotation_cycle(integer, sns_medium[]);
create or replace function public.run_sns_rotation_cycle(
  per_kind integer default 1,
  enabled_media sns_medium[] default array['threads']::sns_medium[]
)
returns table (
  picked_type sns_target_type,
  picked_id   uuid,
  log_count   integer
)
language plpgsql security definer set search_path = public
as $$
declare
  v_rec record;
  v_medium sns_medium;
  v_count integer;
begin
  for v_rec in select * from pick_next_sns_targets(per_kind) loop
    v_count := 0;
    foreach v_medium in array enabled_media loop
      insert into sns_post_logs (target_type, target_id, medium, status, error_message)
      values (v_rec.target_type, v_rec.target_id, v_medium, 'pending',
              'rotation cycle: awaiting dispatch');
      v_count := v_count + 1;
    end loop;
    update sns_rotation
       set last_spotlighted_at = now()
     where target_type = v_rec.target_type
       and target_id = v_rec.target_id;
    picked_type := v_rec.target_type;
    picked_id := v_rec.target_id;
    log_count := v_count;
    return next;
  end loop;
end;
$$;

-- 2. 古い未承認下書きの自動掃除。
--    30日を超えても承認されなかった pending は配信意思がないとみなして削除する
--    （承認済み・配信済み・失敗ログは監査のため削除しない）。
create or replace function public.cleanup_stale_sns_drafts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from sns_post_logs
   where status = 'pending'
     and approved_at is null
     and created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_sns_cleanup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'cidao_sns_cleanup',
  '30 0 * * *',  -- 毎日 0:30 UTC = JST 9:30（ローテーション生成の30分後）
  $$select public.cleanup_stale_sns_drafts();$$
);

-- 3. 既に溜まっている分の一括整理（1回きり）。
--    「未接続媒体（X/Facebook/LINE）向け」かつ「本文が未作成」の未承認 pending は
--    誰も手を付けていない自動生成行なので、日数を待たずに削除してよい。
--    運営が本文を書いた行（content あり）は媒体を問わず残す。
delete from sns_post_logs
 where status = 'pending'
   and approved_at is null
   and (content is null or content = '')
   and medium in ('x', 'facebook', 'line');
