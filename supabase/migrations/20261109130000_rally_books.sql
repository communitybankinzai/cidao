-- =============================================================
-- rally_books — 文化財スタンプラリー（cbi-site/metaverse/rally/）のスタンプ帳
--
-- 背景: 観光客は CiDAO に登録できない（印西市民と関係人口のみ）ので、
--       「スタンプ帳コード」だけで続きから集められるようにする（2026-11-09 事業主決定）。
--       名前・連絡先・端末情報は持たない。保存するのはコード・取ったスタンプ（reportId → 日時）だけ。
--       将来 CiDAO に「観光客」の枠ができたときに紐づけられるよう member_id を空で持つ。
--
-- 読み書きは /api/rally-book（service_role）だけ。anon / authenticated には権限を与えない
-- （2026-10-30 以降の新テーブルは Data API の権限が自動で付かないので、明示的に revoke しておく）。
-- =============================================================

create table if not exists public.rally_books (
  code        text primary key check (code ~ '^[A-Z0-9]{8,12}$'),
  stamps      jsonb not null default '{}'::jsonb,
  member_id   uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.rally_books is '文化財スタンプラリーのスタンプ帳（コードのみ・個人情報なし）。API: /api/rally-book';
comment on column public.rally_books.stamps is '{ "<reportId>": { "at": ISO8601, "lat": 小数4桁, "lon": 小数4桁 } } の形';

create index if not exists idx_rally_books_updated on public.rally_books(updated_at);

alter table public.rally_books enable row level security;

revoke all on public.rally_books from anon;
revoke all on public.rally_books from authenticated;
-- service_role は RLS を通らないので、API（adminClient）からだけ読み書きできる
