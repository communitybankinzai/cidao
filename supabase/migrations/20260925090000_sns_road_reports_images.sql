-- SNS通行情報：添付写真から AI が読み取った手掛かりと、公式の埋め込み表示のアドレス（2026-09-25 事業主決定）。
-- 写真そのものは保存しない（転載しない）。地図は embed_url の公式埋め込みで出す
alter table public.disaster_sns_road_reports add column if not exists image_note text not null default '';
alter table public.disaster_sns_road_reports add column if not exists embed_url text not null default '';
