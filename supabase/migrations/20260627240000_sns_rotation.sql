-- SNS 定期紹介ローテーション
-- ====================================
-- 目的: 印西の FreeFree 投稿・イベント・団体を X / Facebook / LINE へ
--       「最近紹介してないもの優先」で日次ピックアップして投稿する。
--
-- 設計:
--   sns_rotation テーブル：(target_type, target_id) → last_spotlighted_at
--   トリガーで freefree_posts (status=active) / events (status=open) /
--   organizations (always) を upsert する。
--   pg_cron が日次で pick_next_sns_targets() を呼び、各 target_type で
--   1 件ずつ最も古い対象を選んで sns_post_logs に pending 行を作る。
--   実投稿は別途 /api/sns/dispatch が pending 行を読んで API を叩く構成。

-- 1. sns_rotation を埋めるトリガー関数
create or replace function public.sync_sns_rotation_freefree()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'active' then
    insert into sns_rotation (target_type, target_id, category, last_spotlighted_at)
    values ('freefree', new.id, new.category, null)
    on conflict (target_type, target_id) do update
      set category = excluded.category;
  end if;
  return new;
end;
$$;

create or replace function public.sync_sns_rotation_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'open' then
    insert into sns_rotation (target_type, target_id, category, last_spotlighted_at)
    values ('event', new.id, null, null)
    on conflict (target_type, target_id) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.sync_sns_rotation_org()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into sns_rotation (target_type, target_id, category, last_spotlighted_at)
  values ('org', new.id, null, null)
  on conflict (target_type, target_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_sns_rotation_freefree on public.freefree_posts;
create trigger trg_sns_rotation_freefree
  after insert or update of status on public.freefree_posts
  for each row execute function public.sync_sns_rotation_freefree();

drop trigger if exists trg_sns_rotation_event on public.events;
create trigger trg_sns_rotation_event
  after insert or update of status on public.events
  for each row execute function public.sync_sns_rotation_event();

drop trigger if exists trg_sns_rotation_org on public.organizations;
create trigger trg_sns_rotation_org
  after insert on public.organizations
  for each row execute function public.sync_sns_rotation_org();

-- 2. 既存データのバックフィル
insert into sns_rotation (target_type, target_id, category, last_spotlighted_at)
select 'freefree', id, category, null from public.freefree_posts where status = 'active'
on conflict (target_type, target_id) do nothing;

insert into sns_rotation (target_type, target_id, category, last_spotlighted_at)
select 'event', id, null, null from public.events where status = 'open'
on conflict (target_type, target_id) do nothing;

insert into sns_rotation (target_type, target_id, category, last_spotlighted_at)
select 'org', id, null, null from public.organizations
on conflict (target_type, target_id) do nothing;

-- 3. ローテーション選出関数
--    各 target_type で最も古く紹介された（or 未紹介）対象を per_kind 件ずつ返す。
--    呼び出し側（API）が content を生成して sns_post_logs に書き、
--    完了後に sns_rotation.last_spotlighted_at を更新する。
create or replace function public.pick_next_sns_targets(per_kind integer default 1)
returns table (
  target_type sns_target_type,
  target_id   uuid,
  category    text,
  last_spotlighted_at timestamptz
)
language sql security definer set search_path = public
as $$
  -- freefree: status=active かつ未期限のみ
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join freefree_posts p on p.id = r.target_id
     where r.target_type = 'freefree'
       and p.status = 'active'
       and (p.expires_at is null or p.expires_at > now())
     order by coalesce(r.last_spotlighted_at, 'epoch'::timestamptz) asc, p.created_at desc
     limit per_kind
  )
  union all
  -- event: status=open かつ未来日のみ
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
      join events e on e.id = r.target_id
     where r.target_type = 'event'
       and e.status = 'open'
       and e.start_at > now()
     order by coalesce(r.last_spotlighted_at, 'epoch'::timestamptz) asc, e.start_at asc
     limit per_kind
  )
  union all
  -- org: 常時候補（削除がないため）
  (
    select r.target_type, r.target_id, r.category, r.last_spotlighted_at
      from sns_rotation r
     where r.target_type = 'org'
     order by coalesce(r.last_spotlighted_at, 'epoch'::timestamptz) asc
     limit per_kind
  );
$$;

-- 4. ローテーション 1サイクル実行関数（pg_cron / 手動から呼ぶ）
--    各 target_type で per_kind 件選び、media 3つに対して pending log を作る。
--    実投稿は /api/sns/dispatch が pending log を読んで実施する。
create or replace function public.run_sns_rotation_cycle(
  per_kind integer default 1,
  enabled_media sns_medium[] default array['x','facebook','line']::sns_medium[]
)
returns table (
  picked_type sns_target_type,
  picked_id   uuid,
  log_count   integer
)
language plpgsql security definer set search_path = public
as $$
declare
  v_rec record;
  v_medium sns_medium;
  v_count integer;
begin
  for v_rec in select * from pick_next_sns_targets(per_kind) loop
    v_count := 0;
    foreach v_medium in array enabled_media loop
      insert into sns_post_logs (target_type, target_id, medium, status, error_message)
      values (v_rec.target_type, v_rec.target_id, v_medium, 'pending',
              'rotation cycle: awaiting dispatch');
      v_count := v_count + 1;
    end loop;
    update sns_rotation
       set last_spotlighted_at = now()
     where target_type = v_rec.target_type
       and target_id = v_rec.target_id;
    picked_type := v_rec.target_type;
    picked_id := v_rec.target_id;
    log_count := v_count;
    return next;
  end loop;
end;
$$;

-- 5. pg_cron 日次ジョブ：毎日 0時 UTC (JST 9時) に 1サイクル
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_sns_rotation';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'cidao_sns_rotation',
  '0 0 * * *',  -- 毎日 0時 UTC = JST 9時
  $$select public.run_sns_rotation_cycle(1);$$
);
