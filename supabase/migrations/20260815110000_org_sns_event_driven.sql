-- =============================================================
-- 団体のSNS紹介をローテーションから外し、イベントドリブンに変更
--
-- 背景: ローテーションは初期一括取り込みの団体（220件超）も古い順に
--       毎日ピックアップするため、「いつ登録されたか分からない団体」の
--       下書きが延々と並ぶ状態だった（2026-08-15 運営指摘）。
--       団体の告知は「新規登録時・紹介内容の更新時」にアプリ側から
--       下書きを作る方式（提案告知と同じ）へ変更する。
--       freefree / event のローテーションは従来どおり。
-- =============================================================

-- 1. ローテーション候補から org を除外（8/8 の未送信除外ロジックは維持）
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
  );
  -- org はローテーションから除外（2026-08-15）。
  -- 新規登録・情報更新時にアプリ側（announceOrgToSns）が下書きを作る
$$;

-- 2. ローテーションが作った既存の団体下書き（本文未作成・未承認）を掃除
delete from sns_post_logs
 where target_type = 'org'
   and status = 'pending'
   and approved_at is null
   and (content is null or content = '');
