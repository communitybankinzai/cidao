-- イベントの「終了時刻は未定」の印（2026-11-27 事業主決定・A案）
--
-- 終了時刻が決まっていない・書かれていない催しを、そのとおりに登録できるようにする。
-- end_at は必須のまま残す（カレンダーに出す期間・「終了した催し」の判定・前日のお知らせなど、
-- 多くの計算が end_at を使っているため）。未定のときは、end_at に開始の1時間後を入れておき、
-- この印が true の催しは、画面に終了時刻を出さずに「終了時刻は未定」と出す。
--
-- 既存の催しは false（今までどおり終了時刻を出す）。再実行しても安全。

alter table public.events
  add column if not exists end_time_unknown boolean not null default false;

comment on column public.events.end_time_unknown is
  '終了時刻は未定。true のとき、画面には終了時刻を出さない（end_at には開始の1時間後が入っている）';
