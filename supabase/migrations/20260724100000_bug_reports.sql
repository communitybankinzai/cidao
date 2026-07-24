-- =============================================================
-- bug_reports — CBIサイト／CiDAOアプリの利用者から寄せられる
-- 不具合・改善要望の報告。未ログイン(anon)でも投稿できる点が
-- 他テーブルと異なる（talent_inquiries等はauthenticated限定）。
--
-- Semantics
--   reporter_id    = ログイン投稿時のmembers.id（未ログインはNULL）
--   reporter_email = 未ログイン投稿時の返信先（任意入力）
--   source         = 'cbi_site' | 'cidao_app'（どちらからの報告か）
--   status         = 管理側のトリアージ状態
--   email_sent_at  = Resend送信タイムスタンプ（未送信/失敗はNULL）
-- =============================================================

create table public.bug_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.members(id) on delete set null,
  reporter_email  text,
  reporter_name   text,
  source          text not null check (source in ('cbi_site', 'cidao_app')),
  page_url        text,
  category        text not null default 'bug' check (category in ('bug', 'feature_request', 'other')),
  description     text not null check (char_length(description) between 1 and 2000),
  status          text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  admin_note      text,
  email_sent_at   timestamptz,
  email_error     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_bug_reports_status on public.bug_reports(status, created_at desc);
create index idx_bug_reports_reporter on public.bug_reports(reporter_id, created_at desc);

alter table public.bug_reports enable row level security;

-- INSERT: 誰でも投稿可能。ログイン中はreporter_id=自分のみ許可、未ログインはNULLのみ許可
create policy bug_reports_insert_anyone
  on public.bug_reports for insert
  to anon, authenticated
  with check (
    reporter_id is null or reporter_id = auth.uid()
  );

-- SELECT: 投稿者本人 + admin
create policy bug_reports_select_self
  on public.bug_reports for select
  to authenticated
  using (reporter_id = auth.uid());

create policy bug_reports_select_admin
  on public.bug_reports for select
  using (public.is_admin());

-- UPDATE: admin のみ（ステータス・admin_note更新）。email_sent_at等はservice_role/trigger相当を想定しService Actionはservice_role経由にする
create policy bug_reports_update_admin
  on public.bug_reports for update
  using (public.is_admin())
  with check (public.is_admin());

create trigger set_bug_reports_updated_at
  before update on public.bug_reports
  for each row execute function public.set_updated_at();
