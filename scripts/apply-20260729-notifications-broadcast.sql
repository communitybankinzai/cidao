-- =============================================================
-- Apply: 20260729190000_notifications_broadcast.sql (+ verification)
--
-- Paste the whole file into Supabase SQL Editor and press Run.
-- The final SELECT returns one row; all three columns must be true.
-- Safe to run repeatedly (drop if exists / add column if not exists).
--
-- NOTE: ASCII only on purpose. Japanese comments got mojibake through
-- the Windows clipboard and broke the statements.
-- =============================================================

-- 1) allow new kinds: freefree / event / member / org
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'comment', 'vote', 'proposal', 'system',
    'freefree', 'event', 'member', 'org'
  ));

-- 2) broadcast_id: one broadcast = one group of rows
alter table public.notifications
  add column if not exists broadcast_id uuid;

create index if not exists idx_notifications_broadcast
  on public.notifications(broadcast_id, created_at desc)
  where broadcast_id is not null;

-- 3) history view for /admin/notice (read with service_role only)
drop view if exists public.notification_broadcasts;

create view public.notification_broadcasts as
select
  broadcast_id,
  kind,
  title,
  body,
  link_url,
  min(created_at)                                   as sent_at,
  count(*)::int                                     as recipients,
  count(*) filter (where read_at is not null)::int  as read_count
from public.notifications
where broadcast_id is not null
group by broadcast_id, kind, title, body, link_url;

revoke all on public.notification_broadcasts from anon, authenticated;
grant select on public.notification_broadcasts to service_role;

-- =============================================================
-- Verification: all three columns must be true
-- =============================================================
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'broadcast_id'
  ) as has_broadcast_id,
  exists (
    select 1 from pg_constraint
    where conname = 'notifications_kind_check'
      and pg_get_constraintdef(oid) like '%freefree%'
  ) as kind_check_updated,
  exists (
    select 1 from information_schema.views
    where table_schema = 'public'
      and table_name = 'notification_broadcasts'
  ) as has_history_view;
