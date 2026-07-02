-- =============================================================
-- notification_log — 提案ライフサイクル通知の送信記録（重複送信防止）
--
-- kind:
--   voting_started : 議論48h終了 → 投票開始の通知
--   deadline_24h   : 投票締切24時間前のリマインダー
--   finalized      : 結果確定（可決/否決/締め切り）の通知
--
-- unique(proposal_id, kind) で「同じ提案の同じ通知は一度だけ」を担保。
-- 送信本体は /api/cron/notify（Vercel Cron 日次 + 手動トリガー可）が行い、
-- service_role で INSERT する。一般ユーザーの書き込みは RLS で全面禁止。
-- =============================================================

create table public.notification_log (
  id               uuid primary key default gen_random_uuid(),
  proposal_id      uuid not null references public.proposals(id) on delete cascade,
  kind             text not null check (kind in ('voting_started', 'deadline_24h', 'finalized')),
  sent_at          timestamptz not null default now(),
  recipients_count integer not null default 0,
  errors_count     integer not null default 0,
  detail           jsonb default '{}'::jsonb,
  unique (proposal_id, kind)
);

create index idx_notification_log_proposal on public.notification_log(proposal_id);

alter table public.notification_log enable row level security;

-- SELECT: 運営（admin_role あり）のみ閲覧可。将来の /admin 通知履歴表示用。
-- INSERT/UPDATE/DELETE のポリシーは作らない → service_role のみが書ける。
create policy notification_log_select_admin
  on public.notification_log for select
  to authenticated
  using (public.is_admin());
