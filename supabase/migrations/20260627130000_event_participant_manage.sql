-- イベント管理者（can_edit_event）が参加者の役割・出欠を管理できるようにする。
--
-- 背景：event_participants には UPDATE ポリシーが存在せず（出欠/役割の更新が全員 RLS で拒否）、
-- SELECT も ep_select_organizer で「イベントの organizer のみ」可視。取り込みイベント（bot 主催）の
-- 投稿者(claim)や団体役員など can_edit_event 相当の管理者が、参加者一覧を見たり出欠をつけたり
-- できなかった。
--
-- 解決：(1) can_edit_event の管理者が参加者一覧を閲覧できる SELECT ポリシー、
--       (2) 役割/出欠を更新する SECURITY DEFINER 関数（authz は can_edit_event）。
-- 出欠を true にすると award_on_event_attendance トリガーが役割に応じてポイントを付与
-- （主催 40 / スタッフ 20 / 参加 5）。

-- 1. 管理者（can_edit_event）は参加者一覧を閲覧可
drop policy if exists ep_select_editor on public.event_participants;
create policy ep_select_editor on public.event_participants
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_id and public.can_edit_event(e)
    )
  );

-- 2. 役割・出欠の更新（can_edit_event の管理者のみ）。SECURITY DEFINER で RLS を回避し、
--    関数内で権限チェックする。role は 'participant' | 'staff' のみ変更可（organizer は据え置き）。
create or replace function public.manage_event_participant(
  p_event_id uuid,
  p_member_id uuid,
  p_role text default null,        -- 'participant' | 'staff' | null(=変更なし)
  p_attended boolean default null  -- null(=変更なし)
)
returns jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_event public.events;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  if not public.can_edit_event(v_event) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_role is not null and p_role not in ('participant', 'staff') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;

  update public.event_participants
     set role = coalesce(p_role::event_participant_role, role),
         attended = coalesce(p_attended, attended)
   where event_id = p_event_id and member_id = p_member_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'participant_not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.manage_event_participant(uuid, uuid, text, boolean) from public;
grant execute on function public.manage_event_participant(uuid, uuid, text, boolean) to authenticated;
