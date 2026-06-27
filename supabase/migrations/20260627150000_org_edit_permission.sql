-- 団体情報の編集権限を can_edit_org() で集約する。
-- 既存 orgs_update_rep は「representative_id == auth.uid()」のみだったため、
-- inzaiparque 取込の 219 件（representative_id がプレースホルダー）は誰も編集できない状態。
-- 自動拡充パイプライン（claude-haiku-4-5 + Web 検索）で集めた provisional な情報を
-- 「本物の代表者」が確認/修正できる経路を開く。
--
-- 編集権限：
--   (a) representative_id = auth.uid()  ← 旧来通り
--   (b) memberships で representative/officer かつ confirmed
--   (c) organizations.contact_email = auth.jwt().email
--      （CiDAO 未登録の代表者でも、メール一致でログイン中なら編集可）
--
-- events.can_edit_event と同じ思想（2026-06-26 確立）。

create or replace function public.can_edit_org(o public.organizations)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select
    -- (a) 旧来：representative_id 本人
    o.representative_id = auth.uid()
    -- (b) memberships で rep/officer かつ confirmed
    or exists (
      select 1 from public.memberships m
       where m.org_id = o.id
         and m.member_id = auth.uid()
         and m.status = 'confirmed'
         and m.role in ('representative', 'officer')
         and m.left_at is null
    )
    -- (c) contact_email が JWT email と一致（inzaiparque 取込団体の救済経路）
    or (
      o.contact_email is not null
      and lower(o.contact_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

-- 旧 orgs_update_rep を置き換え
drop policy if exists orgs_update_rep on public.organizations;
create policy orgs_update_editor on public.organizations
  for update using (public.can_edit_org(organizations))
            with check (public.can_edit_org(organizations));

comment on function public.can_edit_org is
  '団体編集可否：representative_id 本人 / officer・rep の confirmed member / contact_email = JWT email のいずれか。'
  '自動拡充された provisional 情報を本物の代表者が確認/修正するための救済経路を含む。';
