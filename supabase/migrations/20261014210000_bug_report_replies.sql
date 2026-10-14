-- =============================================================
-- bug_report_replies — 報告者への返信の履歴
--
-- 背景: bug_reports.reply_text / replied_at は「最新の返信1件」しか持てず、
--       再送すると前の返信が上書きされて運営画面から消えていた。
--       返信を1通ずつ積んで、いつ・誰が・何を返したかを後から追えるようにする。
--
-- bug_reports の最新返信の列（reply_text / replied_at / replied_by）は残す。
-- 履歴は運営だけが読める（報告者本人は通知＝ベル🔔で受け取る）。
-- =============================================================

create table if not exists public.bug_report_replies (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.bug_reports(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  replied_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_bug_report_replies_report
  on public.bug_report_replies(report_id, created_at);

alter table public.bug_report_replies enable row level security;

revoke all on public.bug_report_replies from anon;
grant select, insert on public.bug_report_replies to authenticated;

drop policy if exists bug_report_replies_select_admin on public.bug_report_replies;
create policy bug_report_replies_select_admin
  on public.bug_report_replies for select
  to authenticated
  using (public.is_admin());

drop policy if exists bug_report_replies_insert_admin on public.bug_report_replies;
create policy bug_report_replies_insert_admin
  on public.bug_report_replies for insert
  to authenticated
  with check (public.is_admin());

-- 既存の最新返信を1件ずつ履歴へ引き継ぐ（二重実行しても増えない）
insert into public.bug_report_replies (report_id, body, replied_by, created_at)
select r.id, r.reply_text, r.replied_by, r.replied_at
from public.bug_reports r
where r.reply_text is not null
  and r.replied_at is not null
  and not exists (
    select 1 from public.bug_report_replies x where x.report_id = r.id
  );
