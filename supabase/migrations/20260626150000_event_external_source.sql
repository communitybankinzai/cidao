-- 外部システムからの取り込みイベントの重複防止・出典記録
--
-- 例：COCoLa Apps Script の画像スキャンが /api/events/ingest 経由で
-- CiDAO にも同じイベントを送る。external_source_id（Drive ファイル ID 等）で
-- 重複を弾く。

alter table public.events
  add column if not exists external_source text,
  add column if not exists external_source_id text;

-- 同一ソース内で id 一意（両方 not null のときだけ）
create unique index if not exists events_external_source_unique
  on public.events(external_source, external_source_id)
  where external_source is not null and external_source_id is not null;

create index if not exists idx_events_external_source
  on public.events(external_source)
  where external_source is not null;
