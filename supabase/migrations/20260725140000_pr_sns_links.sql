-- =============================================================
-- 公開PR（member_profiles_pr）にSNS・ウェブサイトのリンク欄を追加
-- 1行に1URLのテキストとして保存し、表示側で http(s) 行のみリンク化する
-- =============================================================

alter table public.member_profiles_pr
  add column if not exists sns_links text;
