-- =============================================================
-- FreeFree掲示板の運営モデレーション
--
-- 現状:
--   freefree_delete_poster には is_committee_or_super() が入っており、
--   運営は「行ごと消す」ことはできた。
--   一方 freefree_update_poster は掲載者本人と団体メンバーだけで、
--   運営が status を 'removed' に落とす（非公開にする）ことができなかった。
--
-- サンプル投稿や迷惑投稿への対応は、まず非公開（status='removed'）にして
-- 様子を見られるほうが安全なので、運営向けの UPDATE ポリシーを足す。
-- 物理削除は従来どおり可能（coupons / supports は on delete cascade）。
--
-- 非公開にした掲載は次の2点で自動的に表に出なくなる:
--   ・一覧/詳細は status='active' で絞っている
--   ・pick_next_sns_targets() が p.status='active' で絞っているので SNS 候補からも外れる
-- =============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'freefree_posts'
       and policyname = 'freefree_update_admin'
  ) then
    create policy freefree_update_admin on public.freefree_posts
      for update using (public.is_committee_or_super())
      with check (public.is_committee_or_super());
  end if;
end $$;

-- 運営が「非公開にした理由」を残せるようにする（監査と誤操作の巻き戻し用）
alter table public.freefree_posts
  add column if not exists moderated_at     timestamptz,
  add column if not exists moderated_by     uuid references public.members(id),
  add column if not exists moderation_note  text;

comment on column public.freefree_posts.moderated_at is
  '運営が非公開にした日時。元に戻すと null に戻る。';
comment on column public.freefree_posts.moderation_note is
  '非公開にした理由（サンプル投稿の片付け／迷惑投稿 など）。掲載者や一般には表示しない。';
