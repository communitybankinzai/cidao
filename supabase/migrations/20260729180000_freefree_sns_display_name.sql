-- =============================================================
-- FreeFree掲示物に「SNSで使ってよい表示名」を追加
--
-- 掲示板の詳細ページは個人・個人事業の掲載者の氏名を表示していないため、
-- SNS 配信でも氏名を出さない運用にしている（本人が意図しない実名公開を防ぐ）。
-- 名前や屋号を出して応援されたい掲載者のために、掲載フォームで明示的に
-- 入力してもらった表示名だけを SNS 本文の名指しに使う。
--
-- 団体掲載（poster_type='org'）は従来どおり organizations.name を使うため、
-- この列が空でも SNS 本文には団体名が入る。
-- =============================================================

alter table public.freefree_posts
  add column if not exists sns_display_name text
    check (sns_display_name is null or char_length(sns_display_name) between 1 and 40);

comment on column public.freefree_posts.sns_display_name is
  'SNS投稿で名指しに使う表示名（掲載者本人が入力したときのみ）。未入力なら活動そのものを主語にする。団体掲載では organizations.name を優先。';
