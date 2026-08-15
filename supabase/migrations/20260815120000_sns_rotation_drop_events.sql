-- =============================================================
-- SNS 定期紹介：イベント（events）をローテーション対象から外す
--
-- 背景: イベントは毎朝のまとめ配信で告知しており、ローテーションでの
--       単独紹介と重複するため不要（2026-08-15 運営判断）。
--       FreeFree は「🌟 イベント」カテゴリの掲載分も含めて単独紹介を継続する。
--       団体は現状維持（登録完了 or 更新済みのみ・20260815100000 の条件のまま）。
--
-- 補足: sync_sns_rotation_event トリガーと sns_rotation の event 行は
--       残す（選出時に無視されるだけで無害。将来戻す場合に備える）。
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
