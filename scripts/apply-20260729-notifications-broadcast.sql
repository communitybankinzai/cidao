-- =============================================================
-- 貼付用: 20260729190000_notifications_broadcast.sql の適用 + 適用確認
--
-- Supabase Dashboard → SQL Editor に全文を貼って Run。
-- 最後の SELECT が結果テーブルに出るので、3列すべて true なら適用成功。
-- 何度実行しても安全（drop if exists / add column if not exists）。
-- =============================================================

-- 1. kind に 'freefree' | 'event' | 'member' | 'org' を追加
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'comment', 'vote', 'proposal', 'system',
    'freefree', 'event', 'member', 'org'
  ));

-- 2. broadcast_id（1回の一斉送信＝1グループ）
alter table public.notifications
  add column if not exists broadcast_id uuid;

create index if not exists idx_notifications_broadcast
  on public.notifications(broadcast_id, created_at desc)
  where broadcast_id is not null;

-- 3. 送信履歴ビュー（管理画面 /admin/notice が service_role で読む）
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
-- 適用確認：3列すべて true なら成功
-- =============================================================
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'broadcast_id'
  ) as broadcast_id列あり,
  exists (
    select 1 from pg_constraint
    where conname = 'notifications_kind_check'
      and pg_get_constraintdef(oid) like '%freefree%'
  ) as kind制約更新済み,
  exists (
    select 1 from information_schema.views
    where table_schema = 'public'
      and table_name = 'notification_broadcasts'
  ) as 履歴ビューあり;
