-- staff 以上の管理者が、全イベントの参加者一覧を横断的に閲覧できるようにする。
--
-- 背景：既存の ep_select_organizer / ep_select_editor は「自分が主催・編集権限を持つ
-- イベント」に限定されており、運営（staff）が /admin 配下から全イベントの参加者を
-- 横断的に確認する手段がなかった。新設する管理画面「イベント参加者一覧」のための
-- ポリシーを追加する（既存ポリシーとは OR 結合され、閲覧範囲を広げるのみ）。

create policy ep_select_admin on public.event_participants
  for select using (public.is_admin());
