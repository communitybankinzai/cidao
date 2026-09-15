-- FreeFree の SNS 告知（2026-09-15）
--
-- 流れ：掲載したらすぐ下書きを作り、運営がベル通知で気づいて承認 → その場で配信（初回）。
--       以後は定期紹介（sns_rotation）が繰り返し告知する。一度承認・配信できた掲載は
--       自動で承認済みにし、本文は配信時（18時台）にカウントダウン付きで作る。
--
-- 1. 開催日（初日）を持つ。カウントダウン「開催まであと◯日」に使う（任意）
-- 2. 定期紹介の候補は「SNS紹介を許可した」かつ「一度でも配信できた」FreeFree だけにする
--    （これまで sns_share=false の掲載も候補に入っていた。初回の承認を経ていない掲載や
--      却下した掲載を、承認なしで流さないためでもある）
-- 3. FreeFree の定期紹介は Threads・Facebook（画像があれば Instagram も）へ、承認済みで下書きを作る

alter table public.freefree_posts add column if not exists event_start_date date;
comment on column public.freefree_posts.event_start_date is
  'イベントの開催日（初日）。SNS告知のカウントダウンに使う。任意。開催最終日は expires_at（掲載終了日）';

create or replace function public.pick_next_sns_targets(per_kind integer default 1)
 returns table(target_type sns_target_type, target_id uuid, category text, last_spotlighted_at timestamp with time zone)
 language sql
 security definer
 set search_path to 'public'
as $function$
  -- freefree: status=active かつ未期限、SNS紹介を許可、一度でも配信済み、未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join freefree_posts p on p.id = r.target_id
     where r.target_type = 'freefree'
       and p.status = 'active'
       and (p.expires_at is null or p.expires_at > now())
       and p.sns_share
       and exists (
         select 1 from sns_post_logs s
          where s.target_type = r.target_type and s.target_id = r.target_id
            and s.status = 'success'
       )
       and not exists (
         select 1 from sns_post_logs l
          where l.target_type = r.target_type and l.target_id = r.target_id
            and l.status = 'pending'
       )
     order by coalesce(r.last_spotlighted_at, 'epoch'::timestamptz) asc, p.created_at desc
     limit per_kind
  )
  union all
  -- event: status=open かつ未来日、未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join events e on e.id = r.target_id
     where r.target_type = 'event'
       and e.status = 'open'
       and e.start_at > now()
       and not exists (
         select 1 from sns_post_logs l
          where l.target_type = r.target_type and l.target_id = r.target_id
            and l.status = 'pending'
       )
     order by coalesce(r.last_spotlighted_at, 'epoch'::timestamptz) asc, e.start_at asc
     limit per_kind
  )
  union all
  -- org: 常時候補（削除がないため）。未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
     where r.target_type = 'org'
       and not exists (
         select 1 from sns_post_logs l
          where l.target_type = r.target_type and l.target_id = r.target_id
            and l.status = 'pending'
       )
     order by coalesce(r.last_spotlighted_at, 'epoch'::timestamptz) asc
     limit per_kind
  );
$function$;

create or replace function public.run_sns_rotation_cycle(
  per_kind integer default 1,
  enabled_media sns_medium[] default array['threads'::sns_medium]
)
 returns table(picked_type sns_target_type, picked_id uuid, log_count integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rec record;
  v_medium sns_medium;
  v_count integer;
  v_media sns_medium[];
  v_has_image boolean;
begin
  for v_rec in select * from pick_next_sns_targets(per_kind) loop
    v_count := 0;
    if v_rec.target_type = 'freefree' then
      -- 一度承認・配信できた掲載（pick_next_sns_targets で絞り込み済み）なので承認済みで作る。
      -- 本文は空のまま置き、18時台の配信時にカウントダウン付きで作る（/api/cron/sns-dispatch）
      select coalesce(cardinality(p.images), 0) > 0 into v_has_image
        from freefree_posts p where p.id = v_rec.target_id;
      v_media := case when v_has_image
                      then array['threads', 'facebook', 'instagram']::sns_medium[]
                      else array['threads', 'facebook']::sns_medium[] end;
      foreach v_medium in array v_media loop
        insert into sns_post_logs (target_type, target_id, medium, status, approved_at, error_message)
        values (v_rec.target_type, v_rec.target_id, v_medium, 'pending', now(),
                'rotation: auto (previously approved)');
        v_count := v_count + 1;
      end loop;
    else
      foreach v_medium in array enabled_media loop
        insert into sns_post_logs (target_type, target_id, medium, status, error_message)
        values (v_rec.target_type, v_rec.target_id, v_medium, 'pending',
                'rotation cycle: awaiting approval');
        v_count := v_count + 1;
      end loop;
    end if;
    -- last_spotlighted_at はここでは更新しない。
    -- 実際に配信が成功したときに mark_sns_spotlighted() が刻む
    picked_type := v_rec.target_type;
    picked_id := v_rec.target_id;
    log_count := v_count;
    return next;
  end loop;
end;
$function$;
