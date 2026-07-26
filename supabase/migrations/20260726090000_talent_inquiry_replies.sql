-- =============================================================
-- talent_inquiries 返信・既読対応（届いた声がけ受信箱）
--
-- 追加カラム
--   reply_to_inquiry_id = スレッドのルート声がけID（返信のとき必須、
--                         何往復してもルートIDを指す。NULL = 新規声がけ）
--   read_at             = 受信者が受信箱で開いた時刻（NULL = 未読）。
--                         更新は server action が service_role で行う
--                         （受信者本人に UPDATE を開放すると message まで
--                         書き換え可能になるため RLS では開放しない）
--
-- ポリシー変更
--   insert_sender : 既存条件に reply_to_inquiry_id is null を追加
--                   （新規声がけ経路で偽スレッドを作れないようにする）
--   insert_reply  : 新設。ルート声がけの当事者（受信者・送信者どちらも）が
--                   同じ相手に対して返信できる。人材バンク掲載チェックは
--                   課さない（受信者は掲載者でない相手に返信するため）
-- =============================================================

alter table public.talent_inquiries
  add column reply_to_inquiry_id uuid references public.talent_inquiries(id) on delete cascade,
  add column read_at timestamptz;

create index idx_talent_inquiries_reply_to
  on public.talent_inquiries(reply_to_inquiry_id, created_at);

drop policy talent_inquiries_insert_sender on public.talent_inquiries;
create policy talent_inquiries_insert_sender
  on public.talent_inquiries for insert
  to authenticated
  with check (
    reply_to_inquiry_id is null
    and from_member_id = auth.uid()
    and from_member_id <> to_member_id
    and exists (
      select 1 from public.members m
      where m.id = auth.uid()
        and m.tier <> 'light'
        and m.deleted_at is null
    )
    and exists (
      select 1 from public.member_profiles_pr p
      where p.member_id = to_member_id
        and p.message_acceptance <> 'closed'
    )
  );

create policy talent_inquiries_insert_reply
  on public.talent_inquiries for insert
  to authenticated
  with check (
    reply_to_inquiry_id is not null
    and from_member_id = auth.uid()
    and from_member_id <> to_member_id
    and exists (
      select 1 from public.talent_inquiries orig
      where orig.id = reply_to_inquiry_id
        and orig.reply_to_inquiry_id is null
        and (
          (orig.to_member_id = auth.uid() and orig.from_member_id = to_member_id)
          or (orig.from_member_id = auth.uid() and orig.to_member_id = to_member_id)
        )
    )
  );
