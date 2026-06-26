-- イベント編集権限の拡張：
-- 既存：events_update_organizer は (organizer=自分) または (org の officer/rep) のみ。
-- 追加要件：
--   1. proxy_registration の場合、organizer_name_text と name が一致する団体の
--      officer/rep も編集可（CiDAO の正規メンバー）
--   2. 関連団体（organizer_id 紐付き or proxy で name 一致）の contact_email が
--      auth.jwt() の email と一致するユーザーも編集可
--      ※ inzaiparque 由来の代表者連絡先など、CiDAO メンバー未登録でもメール照合で
--        編集できるようにする

create or replace function public.can_edit_event(event_row public.events)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select
    -- 既存ルール: 個人主催本人
    (event_row.organizer_type = 'member' and event_row.organizer_id = auth.uid())
    -- 既存ルール: 主催団体の officer/rep
    or (event_row.organizer_type = 'org' and public.is_org_officer(event_row.organizer_id))
    -- 追加: proxy 登録 + name 一致団体の officer/rep
    or (
      event_row.proxy_registration = true
      and event_row.organizer_name_text is not null
      and exists (
        select 1 from public.organizations o
        where o.name = event_row.organizer_name_text
          and public.is_org_officer(o.id)
      )
    )
    -- 追加: 関連団体の contact_email が auth.jwt().email と一致
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

drop policy if exists events_update_organizer on public.events;
create policy events_update_organizer on public.events
  for update using (public.can_edit_event(events))
              with check (public.can_edit_event(events));

-- delete も同じ条件に揃える（既存は organizer 本人 or org officer or 委員）
drop policy if exists events_delete_organizer on public.events;
create policy events_delete_organizer on public.events
  for delete using (
    public.can_edit_event(events) or public.is_committee_or_super()
  );
