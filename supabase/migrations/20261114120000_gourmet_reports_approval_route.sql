-- 食レポの登録実績グラフ用：巡回の食レポを、だれが承認したか（自動／手動）を残す（2026-11-14）
--   auto    … 自動処理（住所調べの自動登録・照合が明確な候補の自動承認）
--   manual  … 運営が管理画面で承認
--   unknown … この列を足す前の行（承認者の記録が空のものは、自動か手作業か見分けられない）
alter table public.gourmet_reports add column if not exists approval_route text;
alter table public.gourmet_reports drop constraint if exists gourmet_reports_approval_route_check;
alter table public.gourmet_reports add constraint gourmet_reports_approval_route_check check (approval_route is null or approval_route in ('auto', 'manual', 'unknown'));

update public.gourmet_reports r set approval_route = case when c.decided_by is not null then 'manual' else 'unknown' end
from public.gourmet_candidates c
where r.source = 'crawl' and r.approval_route is null and r.candidate_id = c.id;
