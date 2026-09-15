-- 外部サイトからのイベント自動取り込み（文化ホール等）の実行記録。
-- 2026-09-16 中司さん指示：実行のたびに件数を1行残し、毎朝「動いた・何件見た」を管理画面で分かるようにする。
-- 書き込みは cron（service_role）だけ。読むのは運営（is_admin）だけ。

create table if not exists public.event_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,                       -- 'inzai-bunka-calendar' 等（events.external_source と同じ値）
  started_at timestamptz not null,
  finished_at timestamptz not null,
  ok boolean not null,
  dry_run boolean not null default false,
  fetched jsonb not null default '{}'::jsonb, -- {list, details, detailFailed, calendar, merged, future}
  inserted integer not null default 0,
  updated integer not null default 0,
  unchanged integer not null default 0,
  duplicates integer not null default 0,
  skipped integer not null default 0,
  errors text[] not null default '{}',
  detail jsonb not null default '{}'::jsonb,  -- inserted/updated/duplicates/skipped の内訳（題名一覧）
  created_at timestamptz not null default now()
);
create index if not exists idx_event_sync_runs_source_started on public.event_sync_runs(source, started_at desc);

alter table public.event_sync_runs enable row level security;
revoke all on public.event_sync_runs from anon, authenticated;
grant select on public.event_sync_runs to authenticated;
grant all on public.event_sync_runs to service_role;

drop policy if exists event_sync_runs_select_admin on public.event_sync_runs;
create policy event_sync_runs_select_admin on public.event_sync_runs for select to authenticated using (public.is_admin());
