-- =============================================================
-- member_private.real_name_normalized: 空白除去済みの検索用正規化列
-- 表記ゆれ対策:
--   「中司 祐樹」「中司祐樹」「中司　祐樹（全角スペース）」等の入力差を
--   検索時に吸収するため、半角/全角スペースを除去した値を生成列として持つ。
--   real_name（表示用の原文）はそのまま、検索だけこの列に対して行う。
-- =============================================================

alter table public.member_private
  add column real_name_normalized text
  generated always as (regexp_replace(coalesce(real_name, ''), '[\s　]+', '', 'g')) stored;
