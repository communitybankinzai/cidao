-- SNS 削除待ち（sns_takedowns）の理由に「superseded＝編集前の古い版」を足す（2026-10-05・事業主指示）。
--
-- 背景: FreeFree の掲載を編集して、紹介文の中身が変わったら、新しい版を自動で SNS に出す。
--       そのとき、すでに出ている古い版は自動では消さず、運営が各 SNS で消せるよう「削除待ち」に載せる。
--       これまでの理由は 'hidden'（非公開）と 'deleted'（完全削除）だけで、編集は想定していなかった。
-- 既存の行・トリガー（freefree_withdrawn_to_takedowns）は変えない。

alter table public.sns_takedowns drop constraint if exists sns_takedowns_reason_check;
alter table public.sns_takedowns
  add constraint sns_takedowns_reason_check check (reason in ('hidden', 'deleted', 'superseded'));

comment on column public.sns_takedowns.reason is
  'hidden=掲載を非公開／deleted=掲載を完全削除／superseded=編集して新しい版を投稿したため、古い版の削除待ち';
