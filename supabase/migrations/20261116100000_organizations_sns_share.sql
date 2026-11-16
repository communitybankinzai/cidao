-- 団体の「公式SNSで紹介してよいか」（2026-11-16）
--
-- これまで団体には、SNSで紹介してよいかを聞く欄が無かった（FreeFree には sns_share がある）。
-- 団体を登録・公開すると紹介の下書きが必ず作られ、運営の承認画面では
-- 「団体が望んだ紹介か」を見分けられなかった。
--
--   sns_share = true  … 団体（登録した会員）が紹介を希望した
--   sns_share = false … 団体が紹介を希望しない → 下書きを作らない・定期紹介の候補にもしない
--   sns_share is null … 団体に聞いていない（運営が公開情報から登録した団体・この列ができる前の団体）
--                       → これまでどおり下書きは作るが、承認画面に「団体の依頼ではありません」と出す

alter table public.organizations
  add column if not exists sns_share boolean;

comment on column public.organizations.sns_share is
  'CBI公式SNSでの紹介。true＝団体が希望／false＝希望しない（下書きを作らない）／null＝団体に聞いていない（運営が登録・列ができる前）';

-- 定期紹介の候補を選ぶ関数を作り直す。
--
-- ⚠ 2026-09-15 の 20260915180000_freefree_sns_countdown.sql が、この関数を古い版から作り直したため、
--    2026-08-15 に決めた次の3つの条件が消えていた（2026-11-16 発覚）：
--      ・イベントは定期紹介の対象外（毎朝のまとめ配信と重なるため・20260815120000）
--      ・団体は「公開中」で「代表者の関与が確認できたもの」だけ（20260815130000）
--      ・運営元の CBI 自身（登録番号 08-001）は対象外（20260815140000）
--    その結果、非公開の団体（運営が非公開にした団体を含む）やイベントの下書きが毎週作られていた。
--    ここで3つの条件を戻し、FreeFree の条件（9/15 の内容）はそのまま残す。
--    この関数を書き換えるときは、必ず「いま本番にある版」を元にすること。
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
  -- org: 公開中で、代表者の関与が確認できたもののみ。
  --      運営元の CBI 自身（登録番号 08-001）は紹介する側なので対象外。
  --      団体が紹介を希望しない（sns_share = false）ものは対象外。
  --      未送信の下書きが無いもの
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join organizations o on o.id = r.target_id
     where r.target_type = 'org'
       and o.public_flag = true
       and o.inzai_registration_number is distinct from '08-001'
       and o.sns_share is distinct from false
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
$function$;
