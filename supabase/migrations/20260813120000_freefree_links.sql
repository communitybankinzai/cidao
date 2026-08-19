-- =============================================================
-- FreeFree掲示物に参考リンクを持たせる
--
-- 背景:
--   URL から告知内容を読み取って掲載する機能を入れるにあたり、
--   元の告知ページ・申込フォーム・SNS などのリンクを保存する場所が無かった。
--   本文（Markdown）に URL を書くこともできるが、掲載者が後から差し替えたり
--   詳細ページでボタンとして見せたりするには独立した列のほうが扱いやすい。
--
-- 形式:
--   [{"label": "申込フォーム", "url": "https://..."}, ...] を最大5件。
--   label は表示名、url は http/https のみ。
-- =============================================================

alter table public.freefree_posts
  add column if not exists links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5);

comment on column public.freefree_posts.links is
  '参考リンク [{label,url}] 最大5件。元の告知ページ・申込フォーム・SNS など。';
