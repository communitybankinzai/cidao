-- =============================================================
-- bug_reports — 報告者への返信
--
-- 背景: これまで運営はステータスと admin_note（内部メモ）を更新できたが、
--       報告者には何も返らなかった。通知への意見・不具合を受け付けるにあたり、
--       「運営が読んで、こう対応した」を本人へ返せるようにする。
--
-- admin_note（内部メモ）とは別の列にする。内部メモをそのまま本人に送ると
-- 見せる前提で書かれていない文章が流出するため、返信は必ずこの列に書く。
--
-- 返信の送信そのものは notifications 経由（ベル🔔＋Webプッシュ）。
-- ここは「いつ・誰が・何を返したか」の記録用。
-- =============================================================

alter table public.bug_reports
  add column if not exists reply_text text;

alter table public.bug_reports
  add column if not exists replied_at timestamptz;

alter table public.bug_reports
  add column if not exists replied_by uuid references public.members(id) on delete set null;

-- 適用確認：3列すべて true なら成功
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bug_reports' and column_name = 'reply_text'
  ) as has_reply_text,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bug_reports' and column_name = 'replied_at'
  ) as has_replied_at,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bug_reports' and column_name = 'replied_by'
  ) as has_replied_by;
