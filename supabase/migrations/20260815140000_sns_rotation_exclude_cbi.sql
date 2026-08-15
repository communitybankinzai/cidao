-- =============================================================
-- SNS 定期紹介：運営元の CBI 自身をローテーション対象から外す
-- ＋イベントの未配信下書きを即時削除（一回きり）
--
-- 背景: CBI（Community Bank Inzai）は CiDAO を運営し他団体を紹介する側で
--       あり、自団体を定期紹介するのは不適切（2026-08-15 運営判断）。
--       識別は市民活動団体登録番号 08-001 で行う（団体名は改称の可能性が
--       あるため使わない）。
--       イベントは 20260815120000 でローテーション対象外にしたため、
--       残っている未配信下書きも30日の自動掃除を待たず削除する
--       （配信済み・失敗ログは監査のため残す）。
-- =============================================================

-- 1. イベントの未配信下書きを削除（一回きり。承認済み含む＝配信前なら全て）
delete from sns_post_logs
 where target_type = 'event'
   and status = 'pending';

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
  -- org: 公開中で、代表者の関与が確認できたもののみ。
  --      運営元の CBI 自身（登録番号 08-001）は紹介する側なので対象外。
  --      未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join organizations o on o.id = r.target_id
     where r.target_type = 'org'
       and o.public_flag = true
       and o.inzai_registration_number is distinct from '08-001'
       and (
         o.info_verified
         or exists (
           select 1 from memberships ms
            where ms.org_id = o.id
              and ms.role = 'representative'
              and ms.status = 'confirmed'
              and ms.left_at is null
         )
       )
       and not exists (
         select 1 from sns_post_logs l
          where l.target_type = r.target_type and l.target_id = r.target_id
            and l.status = 'pending'
       )
     order by coalesce(r.last_spotlighted_at, 'epoch'::timestamptz) asc
     limit per_kind
  );
$$;
