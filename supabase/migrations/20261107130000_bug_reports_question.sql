-- 運営への連絡（/bug-report）に「使い方の質問・相談」（question）の区分を足す（2026-11-07 事業主決定A）。
-- 提案の書き方がわからない会員が、不具合ではなく「相談」として運営に送れるようにする。返事は従来どおりベルに返る。
alter table public.bug_reports drop constraint if exists bug_reports_category_check;
alter table public.bug_reports
  add constraint bug_reports_category_check
  check (category = any (array['bug'::text, 'feature_request'::text, 'question'::text, 'other'::text]));
