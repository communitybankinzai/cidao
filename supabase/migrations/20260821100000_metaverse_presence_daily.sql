-- メタバース印西 日別ユニーク利用者数
-- 在席確認（metaverse_presence）は10分で消えるため、日別の人数を残す蓄積用テーブル。
-- 保存するのは端末側で生成した乱数のセッションIDのみ（個人情報なし）。
-- 管理画面のアクセス分析で、Map Tiles リクエスト数と重ねて表示する。
create table if not exists public.metaverse_presence_daily (
  day date not null,
  session_id text not null,
  mode text not null default 'event',
  first_seen timestamptz not null default now(),
  primary key (day, session_id)
);

alter table public.metaverse_presence_daily enable row level security;
-- ポリシーは作らない（anon/authenticated は一切アクセス不可。service_role のみ）
grant all on table public.metaverse_presence_daily to service_role;
