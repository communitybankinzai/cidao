-- イベントチラシ画像の保存場所と紐づけ
--
-- COCoLa 同様、画像本体は public バケットに置いて URL で参照する。
-- 無料枠（1GB ストレージ / 5GB 帯域 / 月）に収める前提。

-- 1. Storage バケット作成（public、5MB 上限、画像のみ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-flyers',
  'event-flyers',
  true,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage RLS（DO で重複定義回避）
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'event_flyers_authenticated_upload'
  ) then
    create policy event_flyers_authenticated_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'event-flyers');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'event_flyers_public_read'
  ) then
    create policy event_flyers_public_read on storage.objects
      for select to public
      using (bucket_id = 'event-flyers');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'event_flyers_owner_delete'
  ) then
    create policy event_flyers_owner_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'event-flyers' and owner = auth.uid());
  end if;
end $$;

-- 3. events.flyer_image_url（チラシ画像の公開 URL）
alter table public.events
  add column if not exists flyer_image_url text;
