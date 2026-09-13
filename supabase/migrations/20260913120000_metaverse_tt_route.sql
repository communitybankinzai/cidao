-- 武蔵屋めぐり（metaverse-tt の course_key 'musashiya'）用：毎回ランダムな経路の長さと経路を保存する。
-- 順位は平均の速さ（route_m ÷ elapsed_ms）で付けるため（2026-09-13）。既存コースでは NULL のまま
alter table public.metaverse_tt_trials add column if not exists route_m integer;
alter table public.metaverse_tt_trials add column if not exists route jsonb;
