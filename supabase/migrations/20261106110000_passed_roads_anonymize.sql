-- =============================================================
-- 通れた道・通れない地点の記録: 端末IDとIPハッシュの保持期限（2026-11-06）
--
-- 背景:
--   device_id と ip_hash は「送信から10分以内の取り消し」と「同じ端末・同じ発信元の間隔制限」にしか使わないが、
--   期限が無く、2026-09-18 以降の全件（487件）に残っていた。端末単位で行動の軌跡を突き合わせられる状態。
--   線の記録そのもの（path・雨の判定・写真）は「冠水時に通れた実績」として残す。
--
-- 方針:
--   30日を過ぎた行の device_id を固定値 'expired'、ip_hash を '' に置き換える（どちらも not null のため）。
--   pg_cron で毎日 0:20（UTC 15:20）に実行。
-- =============================================================

create or replace function public.anonymize_old_passed_roads()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  update public.disaster_passed_roads
     set device_id = 'expired', ip_hash = ''
   where created_at < now() - interval '30 days'
     and (device_id <> 'expired' or ip_hash <> '');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.anonymize_old_passed_roads() is
  '通れた道の記録のうち30日を過ぎた行の端末ID・IPハッシュを消す（線は残す）。pg_cron cidao_passed_roads_anonymize が毎日実行';

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_passed_roads_anonymize';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule('cidao_passed_roads_anonymize', '20 15 * * *', $$select public.anonymize_old_passed_roads();$$);
