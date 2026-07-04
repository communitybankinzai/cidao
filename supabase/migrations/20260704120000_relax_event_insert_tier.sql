-- イベント投稿を tier='light'（仮登録）のユーザーにも解放する。
-- 背景：代理登録（主催者不明の地域イベント等）や公式アカウントでの投稿が
-- プロフィール未完成のうちはできず、実運用上の障害になっていたため。
-- 主催者チェック（organizer_type/organizer_id）自体は従来どおり維持。

drop policy if exists events_insert_member on public.events;
create policy events_insert_member on public.events
  for insert with check (
    exists (select 1 from public.members where id = auth.uid())
    and (
      (organizer_type = 'member' and organizer_id = auth.uid())
      or (organizer_type = 'org' and public.is_org_officer(organizer_id))
    )
  );
