-- 紹介ページ（/talent/[id]）の「活動の足あと」を本人が隠せる設定（2026-09-15 中司さん決定・案A）。
-- 既定は表示。足あとには、もともと公開されている記録（所属団体・提案・意見の数・主催イベント）だけを、
-- 見る人の権限で読んで出す。新しく公開になる情報はない。
alter table public.members add column if not exists show_footprints boolean not null default true;
-- members は列ごとに UPDATE を許可しているため、新しい列も本人が変えられるように許可する
grant update (show_footprints) on public.members to authenticated;
