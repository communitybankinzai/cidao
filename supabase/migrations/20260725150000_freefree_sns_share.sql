-- =============================================================
-- FreeFree掲示物にSNS紹介の本人同意フラグを追加
-- 掲載フォームの「SNSでの紹介を許可する」チェック（既定ON）に対応。
-- 定期SNS配信のローテーションは sns_share=true の掲示物のみを対象にする
-- =============================================================

alter table public.freefree_posts
  add column if not exists sns_share boolean not null default true;
