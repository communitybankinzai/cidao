-- =============================================================
-- notifications — 災害情報の通知（kind = 'disaster'）
--
-- 背景: 防災MAPの災害情報（市の避難情報・気象警報・沼川の危険水位・通行止め・
--       通れない冠水道路）を、マイメニューで希望した会員にだけベル🔔＋Webプッシュで知らせる。
--       希望は members.contact_preferences.notify_disaster（初期OFF＝未設定は受け取らない）。
--       細かい種類は notify_disaster_evac / _warning / _river / _closure / _flood（未設定はON）。
--
-- 変更点: kind に 'disaster' を追加するだけ（既存の行・制約は変えない）
-- =============================================================

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'comment', 'vote', 'proposal', 'system',
    'freefree', 'event', 'member', 'org',
    'disaster'
  ));
