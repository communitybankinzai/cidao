-- =============================================================
-- 🐛 talent_inquiries_insert_reply の名前解決バグ修正
--
-- 旧ポリシーは EXISTS サブクエリ内で reply_to_inquiry_id /
-- to_member_id を修飾なしで参照していたため、PostgreSQL の
-- スコープ規則により新行ではなく orig（サブクエリ側）の同名
-- カラムに解決され、「orig.id = orig.reply_to_inquiry_id」
--（ルート行では常に NULL）となって条件が絶対に成立しない
-- → 返信 INSERT が常に RLS 違反で失敗していた。
-- 新行のカラムはポリシー対象テーブル名（talent_inquiries.）で
-- 明示修飾して参照する。
-- =============================================================

drop policy talent_inquiries_insert_reply on public.talent_inquiries;

create policy talent_inquiries_insert_reply
  on public.talent_inquiries for insert
  to authenticated
  with check (
    talent_inquiries.reply_to_inquiry_id is not null
    and talent_inquiries.from_member_id = auth.uid()
    and talent_inquiries.from_member_id <> talent_inquiries.to_member_id
    and exists (
      select 1 from public.talent_inquiries orig
      where orig.id = talent_inquiries.reply_to_inquiry_id
        and orig.reply_to_inquiry_id is null
        and (
          (orig.to_member_id = auth.uid() and orig.from_member_id = talent_inquiries.to_member_id)
          or (orig.from_member_id = auth.uid() and orig.to_member_id = talent_inquiries.to_member_id)
        )
    )
  );
