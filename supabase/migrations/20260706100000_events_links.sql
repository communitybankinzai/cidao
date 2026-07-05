-- イベント詳細ページに公式サイトリンク・申込フォームリンクを掲載できるようにする

alter table public.events
  add column if not exists website_url text,
  add column if not exists form_url    text;

comment on column public.events.website_url is '公式サイト・告知ページURL（任意）';
comment on column public.events.form_url    is '参加申込フォームURL（任意）';
