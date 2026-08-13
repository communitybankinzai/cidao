-- =============================================================
-- 「まだ投稿していないのに紹介済みになる」問題の修正
--
-- 現象:
--   run_sns_rotation_cycle が下書き（pending ログ）を作った直後に
--   sns_rotation.last_spotlighted_at = now() を書いていた。
--   承認前・配信前でも「前回 8/8 紹介」と表示され、実際には一度も投稿
--   されていない掲載がローテーションの後ろへ回されていた。
--
-- 修正:
--   1. 下書き作成時には last_spotlighted_at を触らない
--   2. 実際に配信が成功した時点で刻む（mark_sns_spotlighted）
--   3. 1 だけだと同じ対象の下書きが毎日増えるため、未送信の下書きが
--      残っている対象は次の候補から除外する
--
-- 補足:
--   sns_rotation には SELECT ポリシーしか無く、アプリのセッションからは
--   UPDATE できない。また提案告知は一般利用者の操作（提案作成）から
--   配信されうるため、更新は security definer 関数で行う。
-- =============================================================

-- 1. 配信成功時に「紹介済み」を刻む関数
create or replace function public.mark_sns_spotlighted(
  p_target_type sns_target_type,
  p_target_id   uuid
)
returns void
language sql security definer set search_path = public
as $$
  update public.sns_rotation
     set last_spotlighted_at = now()
   where target_type = p_target_type
     and target_id = p_target_id;
$$;

grant execute on function public.mark_sns_spotlighted(sns_target_type, uuid) to authenticated, service_role;

-- 2. 未送信の下書きが残っている対象は次の候補から外す
create or replace function public.pick_next_sns_targets(per_kind integer default 1)
returns table (
  target_type sns_target_type,
  target_id   uuid,
  category    text,
  last_spotlighted_at timestamptz
)
language sql security definer set search_path = public
as $$
  -- freefree: status=active かつ未期限、未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join freefree_posts p on p.id = r.target_id
     where r.target_type = 'freefree'
       and p.status = 'active'
       and (p.expires_at is null or p.expires_at > now())
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
$$;

-- 3. ローテーションは下書きを作るだけにする（last_spotlighted_at を触らない）
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
              'rotation cycle: awaiting approval');
      v_count := v_count + 1;
    end loop;
    -- last_spotlighted_at はここでは更新しない。
    -- 実際に配信が成功したときに mark_sns_spotlighted() が刻む
    picked_type := v_rec.target_type;
    picked_id := v_rec.target_id;
    log_count := v_count;
    return next;
  end loop;
end;
$$;

-- 4. 一度も配信していないのに「紹介済み」になっている分を取り消す。
--    成功ログが1件も無い対象は、実際には未紹介なので null に戻す。
update public.sns_rotation r
   set last_spotlighted_at = null
 where r.last_spotlighted_at is not null
   and not exists (
     select 1 from public.sns_post_logs l
      where l.target_type = r.target_type
        and l.target_id = r.target_id
        and l.status = 'success'
   );
