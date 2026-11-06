-- =============================================================
-- 食レポ飲食店マップ（CBIサイト site/gourmet-map）（2026-11-06）
--
-- 市民が SNS の食レポの URL を飲食店のピンに付ける。匿名・すぐ公開・運営が伏せる（防災MAPの通れた道と同じ運用）。
--   gourmet_shops   : OpenStreetMap に無いお店を市民が足したもの
--   gourmet_reports : 食レポ（SNS の URL）。お店は shop_ref（osm:n123 / shop:<uuid> / ff:<uuid>）で指す
-- 写真は「自分の投稿です」のときだけ1枚（バケット gourmet-images・API が JPEG に作り直して位置情報を落とす）。
-- 読み書きは API（service_role）だけ。端末ID・IPハッシュは30日で消す（通れた道と同じ）。
-- =============================================================

create table if not exists public.gourmet_shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  address text check (address is null or char_length(address) <= 100),
  lat double precision not null,
  lon double precision not null,
  device_id text not null,
  ip_hash text not null default '',
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.gourmet_reports (
  id uuid primary key default gen_random_uuid(),
  shop_ref text not null,
  shop_name text not null,
  lat double precision not null,
  lon double precision not null,
  url text not null check (char_length(url) <= 500),
  platform text not null,
  author_handle text check (author_handle is null or char_length(author_handle) <= 40),
  is_own boolean not null default false,
  image_url text,
  comment text check (comment is null or char_length(comment) <= 100),
  device_id text not null,
  ip_hash text not null default '',
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint gourmet_reports_image_own check (image_url is null or is_own)
);

create unique index if not exists gourmet_reports_shop_url on public.gourmet_reports (shop_ref, url);
create index if not exists gourmet_reports_created on public.gourmet_reports (created_at desc);
create index if not exists gourmet_reports_device on public.gourmet_reports (device_id, created_at desc);
create index if not exists gourmet_shops_device on public.gourmet_shops (device_id, created_at desc);

alter table public.gourmet_shops enable row level security;
alter table public.gourmet_reports enable row level security;
revoke all on public.gourmet_shops from anon, authenticated;
revoke all on public.gourmet_reports from anon, authenticated;
grant all on public.gourmet_shops to service_role;
grant all on public.gourmet_reports to service_role;

comment on table public.gourmet_shops is '食レポ飲食店マップ：OpenStreetMap に無いお店を市民が足したもの（API経由のみ）';
comment on table public.gourmet_reports is '食レポ飲食店マップ：SNS の食レポの URL（API経由のみ）。写真は is_own のときだけ';

-- 公開の写真置き場（ダウンロードだけ公開。書き込みは API の service_role だけ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gourmet-images', 'gourmet-images', true, 1048576, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 30日を過ぎた行の端末ID・IPハッシュを消す（取り消しと連投制限にしか使わないため）
create or replace function public.anonymize_old_gourmet()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_a integer;
  v_b integer;
begin
  update public.gourmet_reports set device_id = 'expired', ip_hash = ''
   where created_at < now() - interval '30 days' and (device_id <> 'expired' or ip_hash <> '');
  get diagnostics v_a = row_count;
  update public.gourmet_shops set device_id = 'expired', ip_hash = ''
   where created_at < now() - interval '30 days' and (device_id <> 'expired' or ip_hash <> '');
  get diagnostics v_b = row_count;
  return v_a + v_b;
end;
$$;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_gourmet_anonymize';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule('cidao_gourmet_anonymize', '25 15 * * *', $$select public.anonymize_old_gourmet();$$);
