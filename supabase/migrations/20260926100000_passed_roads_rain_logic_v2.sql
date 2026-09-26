-- 通れた道・通れない地点の雨の判定を作り直した（2026-09-26・src/lib/disaster-rain-logic.ts）。
-- 周辺4か所のアメダスの重み付け平均で、排水が追いつかない雨（バケツ）と、水が引くまでの時間（先行降雨）を見る。
alter table public.disaster_passed_roads
  add column if not exists rain_72h_mm numeric,
  add column if not exists rain_peak1h_mm numeric,   -- 記録の前3時間で一番強かった1時間の雨
  add column if not exists rain_bucket_mm numeric,   -- 前3時間に排水（D mm/h）を超えてあふれた量の最大
  add column if not exists rain_api_mm numeric,      -- 割り引いた雨の合計（半減期 H 時間）
  add column if not exists rain_basis text,          -- flood_likely の理由：intensity（雨の強さ）／aftermath（大雨の後）
  add column if not exists rain_logic text;          -- 判定の版（例 v2-2026-09-26）
