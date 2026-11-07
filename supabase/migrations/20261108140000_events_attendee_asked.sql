-- 参加者数のお願い通知を出した時刻（2026-11-08）
-- 開催後に、イベントを登録した人へ「参加者数を教えてください」と知らせる（/api/cron/attendance-ask）。
-- 同じ催しには1回だけ。出したら時刻を入れて、翌日以降は聞かない（しつこくしない）。
alter table public.events
  add column if not exists attendee_asked_at timestamptz;

comment on column public.events.attendee_asked_at is '参加者数のお願い通知を出した時刻。null＝まだ聞いていない（通知の対象外の催しも null のまま）';
