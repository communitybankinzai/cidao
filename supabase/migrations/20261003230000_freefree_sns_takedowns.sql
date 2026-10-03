-- FreeFree の掲載を取り下げたとき、SNS に出た紹介投稿の「削除待ち」を作る（2026-10-03）
--
-- 方針：掲載を取り下げたら、SNS の紹介投稿の削除は CBI 運営が行う（自動では消えない）。
--       削除し忘れを防ぐため、取り下げの瞬間に「削除すべき投稿の一覧」を DB に残し、
--       アプリ側（src/lib/sns-takedown.ts）が運営へベル・プッシュ・メールで知らせる。
--
-- 「取り下げ」の定義：
--   ・status が 'removed' になった（管理画面の非公開／取込の置き換えによる自動非公開）
--   ・行が完全削除された（管理画面の削除）
--   どちらの経路でも漏れないよう、アプリのコードではなく DB トリガーで拾う。
--
-- 1. sns_takedowns：削除待ちの一覧。掲載名・媒体・投稿ID・取り下げ日時を控える
--    （完全削除すると掲載名が引けなくなるため、取り下げ時点のスナップショットを持つ）
-- 2. トリガー：配信済み（status='success'）の投稿を 1 件 1 行で控え、未配信の下書きは消す
--    （取り下げた掲載の下書きが、あとから承認・配信されないように）
-- 3. 管理者は一覧を読め、「削除済み」にできる（removed_at を書く）。追加はトリガーのみ

create table if not exists public.sns_takedowns (
  id            uuid primary key default gen_random_uuid(),
  log_id        uuid not null unique,          -- sns_post_logs.id（同じ投稿を二重に控えない）
  target_id     uuid not null,                 -- freefree_posts.id（完全削除後は存在しない）
  post_title    text not null,                 -- 取り下げ時点の掲載名
  medium        sns_medium not null,
  posted_id     text,                          -- 各 SNS が返した投稿ID
  posted_at     timestamptz,
  reason        text not null check (reason in ('hidden', 'deleted')),
  withdrawn_at  timestamptz not null default now(),
  notified_at   timestamptz,                   -- 運営へ通知した時刻。null は未通知
  removed_at    timestamptz,                   -- 運営が SNS で削除した時刻。null は削除待ち
  removed_by    uuid references public.members(id) on delete set null
);
create index if not exists idx_sns_takedowns_open on public.sns_takedowns (withdrawn_at) where removed_at is null;
create index if not exists idx_sns_takedowns_unnotified on public.sns_takedowns (withdrawn_at) where notified_at is null;
create index if not exists idx_sns_takedowns_target on public.sns_takedowns (target_id);

alter table public.sns_takedowns enable row level security;

create policy sns_takedowns_select_admin on public.sns_takedowns
  for select using (public.is_admin());

-- 「削除済み」にする操作。管理者のみ。行の追加・削除はできない
create policy sns_takedowns_update_admin on public.sns_takedowns
  for update using (public.is_admin()) with check (public.is_admin());

grant select, update (removed_at, removed_by) on public.sns_takedowns to authenticated;

create or replace function public.freefree_withdrawn_to_takedowns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old record := old;
  v_reason text;
begin
  if tg_op = 'DELETE' then
    v_reason := 'deleted';
  else
    -- 非公開になった瞬間だけ（すでに非公開のものを更新しても二重に拾わない）
    if new.status is distinct from 'removed' or old.status is not distinct from 'removed' then
      return new;
    end if;
    v_reason := 'hidden';
  end if;

  insert into sns_takedowns (log_id, target_id, post_title, medium, posted_id, posted_at, reason)
  select l.id, v_old.id, v_old.title, l.medium, l.posted_id, l.posted_at, v_reason
    from sns_post_logs l
   where l.target_type = 'freefree'
     and l.target_id = v_old.id
     and l.status = 'success'
  on conflict (log_id) do nothing;

  -- 未配信の下書き（承認待ち・配信待ち）は、取り下げた掲載から出してはならないので消す
  delete from sns_post_logs
   where target_type = 'freefree' and target_id = v_old.id and status = 'pending';

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists trg_freefree_withdrawn_takedowns on public.freefree_posts;
create trigger trg_freefree_withdrawn_takedowns
  after update of status or delete on public.freefree_posts
  for each row execute function public.freefree_withdrawn_to_takedowns();

comment on table public.sns_takedowns is
  'FreeFree 掲載の取り下げで生じた、SNS 紹介投稿の削除待ち。運営が各 SNS で削除し、removed_at を書く';
