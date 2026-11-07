-- 開催後の参加者数（2026-11-08）
-- 「こどもの居場所カレンダー」（/events/kodomo）の実績の根拠として、開催後に人数を入れられるようにする。
--   attendee_count         実際の参加者数（主催者または運営が報告した人数）。null＝未報告（0人ではなく『不明』）
--   attendee_count_source  人数を入れた人：organizer＝主催者・登録者／operator＝運営
-- 参加登録（event_participants）は CiDAO の会員の「行く予定」にすぎず、実際の人数ではないので別にする。
-- 人数を入れられるのは、開始時刻を過ぎたイベントだけ（アプリ側で検査）。

alter table public.events
  add column if not exists attendee_count integer
    check (attendee_count is null or (attendee_count >= 0 and attendee_count <= 100000)),
  add column if not exists attendee_count_source text
    check (attendee_count_source is null or attendee_count_source in ('organizer', 'operator'));

comment on column public.events.attendee_count is '開催後の実際の参加者数（報告された人数）。null＝未報告（0人ではなく不明）';
comment on column public.events.attendee_count_source is '参加者数を入れた人。organizer＝主催者・登録者／operator＝運営';
