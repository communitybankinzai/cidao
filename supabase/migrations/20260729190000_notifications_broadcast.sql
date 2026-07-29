-- =============================================================
-- notifications — 全体配信（broadcast）対応
--
-- 背景: これまで notifications は「関係者1人ずつ」への通知だけを扱ってきた。
--       新着イベント・FreeFree掲載・新規提案・メンバー本登録・団体公開/更新
--       のように「メンバー全員に知らせるべきアクション」と、管理者からの
--       一斉お知らせを同じ仕組みで流せるようにする。
--
-- 変更点
--   1. kind に 'freefree' | 'event' | 'member' | 'org' を追加
--   2. broadcast_id を追加
--      同じ一斉送信でできた行に共通のUUIDを振る。管理画面の送信履歴で
--      「1回の送信＝1グループ」として集計・重複送信の確認に使う。
--      1対1の通知（コメント・投票など）では NULL のまま。
--
-- 挿入は従来どおり service_role のみ（RLSポリシーは追加しない）。
-- =============================================================

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'comment', 'vote', 'proposal', 'system',
    'freefree', 'event', 'member', 'org'
  ));

alter table public.notifications
  add column if not exists broadcast_id uuid;

create index if not exists idx_notifications_broadcast
  on public.notifications(broadcast_id, created_at desc)
  where broadcast_id is not null;

-- -------------------------------------------------------------
-- notification_broadcasts — 一斉送信の履歴（1回の送信＝1行）
--
-- notifications は「宛先1人＝1行」なので、送信履歴を見るには集計が要る。
-- 管理画面（/admin/notice）はこのビューを service_role で読む。
-- 一般ユーザーには公開しない（他人宛の通知が見えてしまうため grant しない）。
-- -------------------------------------------------------------

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
