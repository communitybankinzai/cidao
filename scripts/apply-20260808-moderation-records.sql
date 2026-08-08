-- =============================================================
-- 2026-08-08 分（その3）（Supabase SQL Editor に貼って実行）
--   supabase/migrations/20260808140000_moderation_records.sql
--
-- 悪質投稿への対応記録（証拠保全）。適用するまで管理画面の
-- 非公開・削除の各操作がエラーで止まります（証拠を残せないまま
-- 消させないため、保全に失敗したら処理ごと中断する設計です）。
--
-- 同日の (1) apply-20260808-freefree-moderation.sql
--        (2) apply-20260808-storage-admin-delete.sql
-- を先に流してください。
-- =============================================================

create table if not exists public.moderation_records (
  id            uuid primary key default gen_random_uuid(),
  target_type   text not null default 'freefree',
  target_id     uuid not null,
  action        text not null check (action in ('hidden', 'restored', 'images_deleted', 'deleted')),
  reason        text,
  snapshot      jsonb not null default '{}'::jsonb,
  poster        jsonb not null default '{}'::jsonb,
  evidence_paths text[],
  actor_id      uuid references public.members(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_moderation_target on public.moderation_records(target_type, target_id);
create index if not exists idx_moderation_created on public.moderation_records(created_at desc);

alter table public.moderation_records enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'moderation_records'
       and policyname = 'moderation_records_select_admin'
  ) then
    create policy moderation_records_select_admin on public.moderation_records
      for select using (public.is_committee_or_super());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'moderation_records'
       and policyname = 'moderation_records_insert_admin'
  ) then
    create policy moderation_records_insert_admin on public.moderation_records
      for insert with check (public.is_committee_or_super());
  end if;
end $$;

grant select, insert on public.moderation_records to authenticated;
grant all on public.moderation_records to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('moderation-evidence', 'moderation-evidence', false, 10485760)
on conflict (id) do update set public = false;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'moderation_evidence_admin_all'
  ) then
    create policy moderation_evidence_admin_all on storage.objects
      for all to authenticated
      using (bucket_id = 'moderation-evidence' and public.is_committee_or_super())
      with check (bucket_id = 'moderation-evidence' and public.is_committee_or_super());
  end if;
end $$;

-- 確認（3行返れば適用済み）
-- select 'moderation_records' from information_schema.tables where table_name = 'moderation_records'
-- union all select 'evidence bucket' from storage.buckets where id = 'moderation-evidence'
-- union all select 'evidence policy' from pg_policies where policyname = 'moderation_evidence_admin_all';
