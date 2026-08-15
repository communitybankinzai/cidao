-- =============================================================
-- SNS 定期紹介：団体候補の条件を「代表者の関与が確認できたもの」に厳格化
--
-- 背景: 20260815100000 では「enriched_at なし かつ 代表者がプレースホルダー
--       でない」を『代表者による登録が完了』とみなしたが、実データでは
--       該当24団体のうち23件が representative_id NULL の管理者代理登録で、
--       団体代表者の承認は済んでいなかった（2026-08-15 運営指摘）。
--       本人の関与なしに公式 SNS で紹介される状態は元の要件に反する。
--
-- 新条件（いずれかを満たす団体のみ候補）:
--   ・更新済み … info_verified = true（代表者が内容を確認・編集済み）
--   ・代表者承認済み … role=representative / status=confirmed の
--     メンバーシップが存在（=代表者による登録・claim が承認まで完了）
--
-- 適用時点の候補は CBI の1件のみになる。候補が1件だと同じ団体が毎回
-- 紹介される点は運営に報告済み。
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
  -- org: 公開中で、代表者の関与が確認できたもののみ。
  --      （更新済み、または承認済みの代表者メンバーシップあり。
  --        管理者の代理登録・一括取り込みの仮登録は紹介しない）
  --      未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join organizations o on o.id = r.target_id
     where r.target_type = 'org'
       and o.public_flag = true
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
