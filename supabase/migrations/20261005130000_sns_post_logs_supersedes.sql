-- 編集後の「新しい版」が、どの古い版を置き換えるかを記録する（2026-10-05・事業主指示）。
--
-- 背景: FreeFree を編集して紹介文が変わったとき、前回の配信から24時間以内だと自動では出さず、
--       「承認待ち」の下書きにして運営が判断する。運営が承認して配信できたときも、
--       SNS に残る古い版を「SNS削除待ち」に載せて、いつでも消せるようにする。
--       承認・即時配信・日次の cron など配信の経路が複数あるため、アプリ側ではなく DB のトリガーで拾う。
--
-- 1. sns_post_logs.supersedes_log_id：置き換える古い版（配信済みのログ）の ID。通常の行は null
-- 2. トリガー：行が success になった瞬間に、古い版を sns_takedowns（reason='superseded'）へ載せる
--    （同じ古い版は log_id の unique で二重に載らない）

alter table public.sns_post_logs
  add column if not exists supersedes_log_id uuid references public.sns_post_logs(id) on delete set null;

comment on column public.sns_post_logs.supersedes_log_id is
  '編集後の新しい版が置き換える古い版（配信済みログ）の ID。配信に成功したら古い版を SNS削除待ちに載せる';

create or replace function public.sns_log_superseded_to_takedowns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status = 'success' and old.status is distinct from 'success' and new.supersedes_log_id is not null then
    insert into sns_takedowns (log_id, target_id, post_title, medium, posted_id, posted_at, reason)
    select o.id, o.target_id, coalesce(p.title, '（掲載名不明）'), o.medium, o.posted_id, o.posted_at, 'superseded'
      from sns_post_logs o
      left join freefree_posts p on p.id = o.target_id
     where o.id = new.supersedes_log_id
    on conflict (log_id) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sns_log_superseded_takedowns on public.sns_post_logs;
create trigger trg_sns_log_superseded_takedowns
  after update of status on public.sns_post_logs
  for each row execute function public.sns_log_superseded_to_takedowns();
