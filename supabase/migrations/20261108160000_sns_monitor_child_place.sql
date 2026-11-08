-- SNS モニタ対象に「取り込む催しの目印」と「取り込む投稿の条件語」を足す（2026-11-08）
-- 居場所系のアカウント（子ども食堂・おやこカフェなど）の投稿から取り込む催しは、題名の判定に頼らず、
-- 種別を『子ども・教育・若者支援』、目印（events.child_place）をここで決めた値に固定する。
--   child_place          : 'ibasho'（居場所型）／'oyako'（親子が集まる場）／null（固定しない＝従来どおり）
--   child_place_keywords : 空なら全投稿が対象。入っていれば、投稿の本文にそのうち1つでも含まれる投稿だけを読む
--                          （食堂以外の投稿も混じるアカウント用。例：駄菓子屋の月1回の地域食堂）
alter table public.sns_monitor_accounts
  add column if not exists child_place text
    check (child_place is null or child_place in ('ibasho', 'oyako')),
  add column if not exists child_place_keywords text[] not null default '{}';

comment on column public.sns_monitor_accounts.child_place is '取り込む催しに付ける子どもの居場所の目印。ibasho／oyako／null（固定しない）';
comment on column public.sns_monitor_accounts.child_place_keywords is '空＝全投稿。入っていれば本文にどれか1つ含まれる投稿だけを取り込む（NFKC・大文字小文字を区別しない）';
