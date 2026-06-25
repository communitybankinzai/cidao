-- events.organizer_name_text
--   未登録の団体名を自由入力で保持するための列。
--   organizer_type='org' のときは organizations.id (organizer_id) が真実、organizer_name_text は補助表示に留める想定。
--   organizer_type='member' のとき、organizer_name_text が入っていれば
--   「ユーザーが第三者の団体イベントを代理登録した」と解釈する（proxy_registration 用途）。

alter table public.events
  add column if not exists organizer_name_text text
    check (organizer_name_text is null or char_length(organizer_name_text) between 1 and 80);
