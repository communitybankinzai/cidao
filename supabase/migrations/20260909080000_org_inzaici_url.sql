-- 団体の「いんざい市民情報サイト」団体ページURL（2026-09-09）
--
-- 街活性室株式会社が運営する いんざい市民情報サイト（印西市市民活動支援センター）には
-- 団体が自ら登録したプロフィールが掲載されている。同サイトの利用規約では登録情報の所有は
-- 印西市とされているため、本文は一切転載せず、出典としてのリンクのみを保持する。
-- website_url（団体の公式サイト）とは別物なので専用列を設ける。

alter table public.organizations
  add column if not exists inzaici_url text;

comment on column public.organizations.inzaici_url is
  'いんざい市民情報サイト（印西市市民活動支援センター）の団体ページURL。本文は転載せず出典リンクのみ保持する';
