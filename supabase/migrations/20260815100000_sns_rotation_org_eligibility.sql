-- =============================================================
-- SNS 定期紹介：団体の候補を「代表者による登録が完了 or 更新済み」に限定
--
-- 背景:
--   これまで org はローテーションの常時候補で、市の公開情報から一括取り込みした
--   仮登録団体（代表者未確認・内容も暫定）まで SNS で紹介される状態だった。
--   本人が関与していない団体を公式 SNS で紹介するのは避けたい。
--
-- 対象条件（/orgs の登録状態バッジと同じ判定）:
--   ・更新済み … info_verified = true（代表者が確認・編集済み）
--   ・新規登録 … ユーザー自身が登録したもの
--                 （enriched_at なし かつ 代表者がシステムプレースホルダーでない）
--   ・除外     … 仮登録（一括取り込み or AI収集で未確認）、非公開（承認待ち）
--
-- プレースホルダー会員は seed-orgs.mjs が作成した
-- display_name = '印西市公式登録（未認証プレースホルダー）' の1件。
-- =============================================================

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
  -- org: 公開中で、代表者による登録が完了（新規登録）or 更新済みのもののみ。
  --      仮登録（一括取り込み・AI収集で未確認）は紹介しない。未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join organizations o on o.id = r.target_id
     where r.target_type = 'org'
       and o.public_flag = true
       and (
         o.info_verified
         or (
           o.enriched_at is null
           and o.representative_id is distinct from (
             select m.id from members m
              where m.display_name = '印西市公式登録（未認証プレースホルダー）'
              limit 1
           )
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
