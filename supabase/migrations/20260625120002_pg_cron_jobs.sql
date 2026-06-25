-- =============================================================
-- Step 11a: pg_cron 自動化ジョブ
-- 仕様§2.4 反映速度方針に基づく定期処理
-- =============================================================

create extension if not exists pg_cron;

-- ===========================
-- 全提案を tick して状態遷移
-- discussion → voting （48h 経過）
-- voting → passed/rejected/closed （voting_end_at 超過）
-- ===========================
create or replace function public.tick_all_proposals()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_rec record;
  v_started integer := 0;
  v_finalized integer := 0;
begin
  -- 議論期間終了 → 投票開始
  for v_rec in
    select id from proposals
     where status = 'discussion'
       and discussion_start_at + interval '48 hours' <= now()
  loop
    perform public.start_voting_if_due(v_rec.id);
    v_started := v_started + 1;
  end loop;

  -- 投票期間終了 → 結果確定
  for v_rec in
    select id from proposals
     where status = 'voting'
       and voting_end_at <= now()
  loop
    perform public.finalize_voting(v_rec.id);
    v_finalized := v_finalized + 1;
  end loop;

  return format('started=%s, finalized=%s', v_started, v_finalized);
end;
$$;

-- ===========================
-- 期限切れ FreeFree 投稿を expired に
-- ===========================
create or replace function public.expire_freefree_posts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  update freefree_posts
     set status = 'expired'
   where status = 'active'
     and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================
-- 古い draft 提案を物理削除（7日以上経過）
-- ===========================
create or replace function public.cleanup_draft_proposals()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  delete from proposals
   where status = 'draft'
     and draft_saved_at is not null
     and draft_saved_at < now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================
-- 休眠ユーザー判定（last_active_at > 6ヶ月 でアクティブ会員から除外）
-- 実装は contributions など他テーブルから推測されるため、
-- ここでは特別な状態フラグは立てず、定足数計算側で都度 last_active_at を見る
-- ===========================
create or replace function public.dormant_member_count()
returns integer
language sql security definer set search_path = public
as $$
  select count(*)
    from public.members
   where tier in ('email_only', 'verified')
     and (last_active_at is null or last_active_at < now() - interval '6 months')
     and deleted_at is null;
$$;

-- ===========================
-- 退会 30日後の物理削除（仕様）
-- deleted_at + 30日 で行削除
-- ===========================
create or replace function public.purge_deleted_members()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  -- auth.users から削除（cascade で public.members も消える）
  delete from auth.users
   where id in (
     select id from public.members
      where deleted_at is not null
        and deleted_at < now() - interval '30 days'
   );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================
-- pg_cron スケジュール登録
-- ===========================
-- 既存ジョブを安全に再登録するため、まず unschedule
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname like 'cidao_%'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end $$;

-- 5分ごとに提案 tick（議論48h・投票end の精度を分単位に）
select cron.schedule(
  'cidao_tick_proposals',
  '*/5 * * * *',
  $$select public.tick_all_proposals();$$
);

-- 毎日 0時（UTC、JST 9時）に期限切れ FreeFree
select cron.schedule(
  'cidao_expire_freefree',
  '0 0 * * *',
  $$select public.expire_freefree_posts();$$
);

-- 毎日 0時5分（UTC）に古い draft 削除
select cron.schedule(
  'cidao_cleanup_drafts',
  '5 0 * * *',
  $$select public.cleanup_draft_proposals();$$
);

-- 毎日 0時10分（UTC）に退会済メンバーの物理削除
select cron.schedule(
  'cidao_purge_deleted',
  '10 0 * * *',
  $$select public.purge_deleted_members();$$
);
