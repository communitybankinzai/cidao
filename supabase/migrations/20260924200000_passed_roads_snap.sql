-- 通れない／通れた道の記録を、道路の中心線へ寄せる（2026-09-24）
--
-- 地図をタップしてなぞる方式のため、1点ずつが道路から平均15m前後ずれている。
-- 拡大すると道から外れて見えるため、最寄りの道路へ寄せる（事業主決定）。
-- 元の座標は path_original に残し、いつでも戻せるようにする。
-- snapped_at が入っている行が、寄せたことのある行。
alter table public.disaster_passed_roads
  add column if not exists path_original jsonb,
  add column if not exists snapped_at timestamptz;

comment on column public.disaster_passed_roads.path_original is
  '道路へ寄せる前の座標。寄せた行だけ入る。戻すときは path = path_original とする';
comment on column public.disaster_passed_roads.snapped_at is
  '道路へ寄せた日時。未処理の行は null';
