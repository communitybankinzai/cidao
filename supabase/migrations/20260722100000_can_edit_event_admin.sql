-- =============================================================
-- can_edit_event に運営委員（admin_role=committee/super）判定を追加
-- =============================================================
-- 背景：events_update_organizer ポリシーは can_edit_event(events) のみを条件に
-- しており、events_delete_organizer とは異なり is_committee_or_super() を
-- 独立して見ていなかった。UI側（canUserEditEvent）は2026-07-21に管理者判定を
-- 追加済みだったため「編集ボタンは出るが更新が反映されない（RLSでUPDATE対象0件）」
-- という不整合が発生していた。can_edit_event 自体に条件を足し、
-- SELECT/UPDATE/DELETE 全ポリシーで一貫して管理者権限が効くようにする。

create or replace function public.can_edit_event(event_row public.events)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select
    -- 運営委員・統括管理者はすべてのイベントを編集・削除できる
    exists (
      select 1 from public.members m
      where m.id = auth.uid() and m.admin_role in ('committee', 'super')
    )
    -- 個人主催本人
    or (event_row.organizer_type = 'member' and event_row.organizer_id = auth.uid())
    -- 主催団体の officer/rep
    or (event_row.organizer_type = 'org' and public.is_org_officer(event_row.organizer_id))
    -- 写真投稿者本人（claim 済み）
    or (event_row.submitter_member_id is not null and event_row.submitter_member_id = auth.uid())
    -- proxy 登録 + name 一致団体の officer/rep
    or (
      event_row.proxy_registration = true
      and event_row.organizer_name_text is not null
      and exists (
        select 1 from public.organizations o
        where o.name = event_row.organizer_name_text
          and public.is_org_officer(o.id)
      )
    )
    -- 関連団体の contact_email が auth.jwt().email と一致
    or exists (
      select 1 from public.organizations o
      where (
        (event_row.organizer_type = 'org' and o.id = event_row.organizer_id)
        or (event_row.proxy_registration = true and event_row.organizer_name_text = o.name)
      )
      and o.contact_email is not null
      and lower(o.contact_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;
