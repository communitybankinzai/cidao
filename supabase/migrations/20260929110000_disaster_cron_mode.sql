-- 災害巡回の間隔を、印西市の注意報・警報に合わせて自動で切り替える（2026-09-29 事業主決定）。
--
-- Vercel の無料枠（Fluid Active CPU 月4時間）を守るため、ふだんは Vercel を呼ぶ2本の巡回を
-- ゆっくり回し（SNS 30分・公式発表 毎時）、雨・風・土砂の注意報かいずれかの警報が
-- 印西市（1223100）に出ている間と、すべて解除されてから3時間は速く回す（SNS 5分・公式発表 10分）。
-- 雷・乾燥・濃霧・霜・低温などの注意報だけでは切り替えない（乾燥注意報は冬に何週間も続くため）。
--
-- 判定は DB の中だけで行い、Vercel は使わない：
--   cidao_disaster_cron_mode_fetch（*/10）… pg_net で気象庁の警報・注意報 JSON を取りに行く
--   cidao_disaster_cron_mode（2-59/10）   … 届いた応答を読んで、2本の巡回の間隔を cron.alter_job で直す
-- 状態は app_settings の disaster_cron_mode に残す（管理画面や手元から確認できるように）。
-- ⚠ scripts/vercel-cpu-cron-slow.py などで手で間隔を変えても、次の判定（最長10分後）で上書きされる。

create or replace function public.disaster_cron_mode_fetch()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request bigint;
begin
  select net.http_get(
    url := 'https://www.jma.go.jp/bosai/warning/data/r8/120000.json',
    headers := '{"User-Agent":"cidao-supabase-cron/1.0"}'::jsonb,
    timeout_milliseconds := 20000
  ) into v_request;

  insert into public.app_settings (key, value, updated_at)
  values ('disaster_cron_mode', jsonb_build_object('requestId', v_request, 'requestedAt', now()), now())
  on conflict (key) do update
    set value = coalesce(public.app_settings.value, '{}'::jsonb)
                || jsonb_build_object('requestId', v_request, 'requestedAt', now()),
        updated_at = now();
  return v_request;
end $$;

-- p_payload を渡すと、それを気象庁の応答とみなして判定する（試験用）。
-- p_apply=false なら巡回の間隔は変えず、状態も保存せずに判定結果だけ返す。
create or replace function public.disaster_cron_mode_tick(
  p_payload jsonb default null,
  p_now timestamptz default now(),
  p_apply boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- 雨・風・土砂の注意報（大雨・土砂災害・洪水・強風・高潮・風雪）
  c_advisory constant text[] := array['10', '29', '18', '15', '19', '13'];
  -- すべての警報・特別警報（気象庁の r8 形式のコード。04 は旧形式の洪水警報）
  c_warning constant text[] := array['02', '03', '04', '05', '06', '07', '08', '09',
                                     '32', '33', '35', '36', '37', '38', '39', '43', '48', '49'];
  c_area constant text := '1223100';
  c_hold constant interval := interval '3 hours';
  c_jobs constant jsonb := '{
    "cidao_disaster_sns_monitor": {"fast": "*/5 * * * *", "normal": "*/30 * * * *"},
    "cidao_disaster_timeline":    {"fast": "*/10 * * * *", "normal": "0 * * * *"}
  }'::jsonb;
  v_state jsonb;
  v_payload jsonb := p_payload;
  v_status int;
  v_latest text;
  v_codes text[];
  v_triggers text[];
  v_last_active timestamptz;
  v_mode text;
  v_prev text;
  v_job record;
  v_want text;
  v_changed jsonb := '[]'::jsonb;
begin
  select value into v_state from public.app_settings where key = 'disaster_cron_mode';
  v_state := coalesce(v_state, '{}'::jsonb);
  v_prev := v_state->>'mode';
  v_last_active := nullif(v_state->>'lastTriggeredAt', '')::timestamptz;

  if v_payload is null then
    select r.status_code, case when r.status_code = 200 then r.content::jsonb end
      into v_status, v_payload
      from net._http_response r
     where r.id = nullif(v_state->>'requestId', '')::bigint;
    if v_payload is null then
      -- 応答が無い・失敗したときは、間隔を変えずに理由だけ残す（前の判定を続ける）
      v_state := v_state || jsonb_build_object(
        'checkedAt', p_now,
        'error', coalesce('気象庁の応答が HTTP ' || v_status, '気象庁の応答がまだ無い')
      );
      if p_apply then
        update public.app_settings set value = v_state, updated_at = now() where key = 'disaster_cron_mode';
      end if;
      return v_state;
    end if;
  end if;

  -- 報は複数並ぶ（最新順とは限らない）。印西市を含む報のうち、いちばん新しい時刻の報を今の状態とみなす
  select max(rep->>'reportDatetime') into v_latest
    from jsonb_array_elements(case jsonb_typeof(v_payload) when 'array' then v_payload else jsonb_build_array(v_payload) end) rep,
         jsonb_each(coalesce(rep->'warning', '{}'::jsonb)) cls,
         jsonb_array_elements(case jsonb_typeof(cls.value) when 'array' then cls.value else '[]'::jsonb end) area
   where coalesce(area->>'areaCode', area->>'code') = c_area;

  select coalesce(array_agg(distinct lpad(kind->>'code', 2, '0')), '{}') into v_codes
    from jsonb_array_elements(case jsonb_typeof(v_payload) when 'array' then v_payload else jsonb_build_array(v_payload) end) rep,
         jsonb_each(coalesce(rep->'warning', '{}'::jsonb)) cls,
         jsonb_array_elements(case jsonb_typeof(cls.value) when 'array' then cls.value else '[]'::jsonb end) area,
         jsonb_array_elements(coalesce(area->'kinds', area->'warnings', '[]'::jsonb)) kind
   where rep->>'reportDatetime' = v_latest
     and coalesce(area->>'areaCode', area->>'code') = c_area
     and kind->>'code' is not null
     and coalesce(kind->>'status', '') !~ '解除|発表警報・注意報はなし|発表なし';

  if v_latest is null then
    v_state := v_state || jsonb_build_object('checkedAt', p_now, 'error', '応答に印西市（1223100）が無い');
    if p_apply then
      update public.app_settings set value = v_state, updated_at = now() where key = 'disaster_cron_mode';
    end if;
    return v_state;
  end if;

  select coalesce(array_agg(c), '{}') into v_triggers
    from unnest(v_codes) c where c = any(c_advisory) or c = any(c_warning);

  if cardinality(v_triggers) > 0 then
    v_last_active := p_now;
  end if;
  v_mode := case when v_last_active is not null and p_now < v_last_active + c_hold then 'fast' else 'normal' end;

  if p_apply then
    for v_job in select jobid, jobname, schedule from cron.job where jobname in (select jsonb_object_keys(c_jobs)) loop
      v_want := c_jobs->v_job.jobname->>v_mode;
      if v_job.schedule is distinct from v_want then
        perform cron.alter_job(job_id := v_job.jobid, schedule := v_want);
        v_changed := v_changed || jsonb_build_object('job', v_job.jobname, 'from', v_job.schedule, 'to', v_want);
      end if;
    end loop;
  end if;

  v_state := v_state - 'error' || jsonb_build_object(
    'mode', v_mode,
    'checkedAt', p_now,
    'reportDatetime', v_latest,
    'activeCodes', to_jsonb(v_codes),
    'triggerCodes', to_jsonb(v_triggers),
    'lastTriggeredAt', v_last_active,
    'normalAfter', case when v_last_active is not null then v_last_active + c_hold end
  );
  if v_mode is distinct from v_prev then
    v_state := v_state || jsonb_build_object('changedAt', p_now, 'previousMode', v_prev);
  end if;
  if jsonb_array_length(v_changed) > 0 then
    v_state := v_state || jsonb_build_object('lastChanges', v_changed);
  end if;

  if p_apply then
    insert into public.app_settings (key, value, updated_at)
    values ('disaster_cron_mode', v_state, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return v_state || jsonb_build_object('changes', v_changed);
end $$;

-- PostgREST から誰でも呼べないようにする（pg_cron は postgres で動く）
revoke all on function public.disaster_cron_mode_fetch() from public, anon, authenticated;
revoke all on function public.disaster_cron_mode_tick(jsonb, timestamptz, boolean) from public, anon, authenticated;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_disaster_cron_mode_fetch';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  select jobid into v_jobid from cron.job where jobname = 'cidao_disaster_cron_mode';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule('cidao_disaster_cron_mode_fetch', '*/10 * * * *', $$select public.disaster_cron_mode_fetch();$$);
select cron.schedule('cidao_disaster_cron_mode', '2-59/10 * * * *', $$select public.disaster_cron_mode_tick();$$);
