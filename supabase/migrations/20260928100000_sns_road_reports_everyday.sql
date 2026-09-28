-- SNSの通行情報を平時にも使う（2026-09-28 事業主決定：道路・交通の困りごと／規約で許される情報源だけ／確度 high だけ自動公開）。
-- 1) 種類に caution（注意：通れるが支障あり＝片側交互通行・車線規制・渋滞・陥没・落下物など）を足す
-- 2) 理由 cause を足す（flood=冠水・浸水／construction=工事／accident=事故／fallen_tree=倒木・落下物／damage=陥没・段差など道路の傷み／
--    congestion=渋滞／other=その他／空文字=不明）。既存の行（台風25号の分）は空文字のまま

alter table public.disaster_sns_road_reports drop constraint if exists disaster_sns_road_reports_kind_check;
alter table public.disaster_sns_road_reports
  add constraint disaster_sns_road_reports_kind_check check (kind in ('passed', 'blocked', 'cleared', 'caution'));

alter table public.disaster_sns_road_reports add column if not exists cause text not null default '';
alter table public.disaster_sns_road_reports drop constraint if exists disaster_sns_road_reports_cause_check;
alter table public.disaster_sns_road_reports
  add constraint disaster_sns_road_reports_cause_check
  check (cause in ('', 'flood', 'construction', 'accident', 'fallen_tree', 'damage', 'congestion', 'other'));
