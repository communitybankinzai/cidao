-- メタバース印西 同時利用者数（在席確認）
-- 各利用者の画面が定期的に自分のセッションIDを送り、直近90秒以内のものを「参加中」として数える。
-- 個人情報は保存しない（端末側で生成した乱数のみ）。古い行は API 側で自動削除する。
create table if not exists public.metaverse_presence (
  session_id text primary key,
  mode text not null default 'event',
  last_seen timestamptz not null default now()
);

alter table public.metaverse_presence enable row level security;
-- ポリシーは作らない（anon/authenticated からは一切アクセス不可。service_role のみ）
grant all on table public.metaverse_presence to service_role;

create index if not exists idx_metaverse_presence_last_seen
  on public.metaverse_presence (last_seen);
