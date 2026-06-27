-- FreeFree 掲載画像の保存場所（最大3枚/投稿、各5MB、画像のみ public）
-- event-flyers バケットと同じ思想で public read + authenticated upload + owner delete。

-- 1. Storage バケット作成
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'freefree-images',
  'freefree-images',
  true,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage RLS
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'freefree_images_authenticated_upload'
  ) then
    create policy freefree_images_authenticated_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'freefree-images');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'freefree_images_public_read'
  ) then
    create policy freefree_images_public_read on storage.objects
      for select to public
      using (bucket_id = 'freefree-images');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'freefree_images_owner_delete'
  ) then
    create policy freefree_images_owner_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'freefree-images' and owner = auth.uid());
  end if;
end $$;

-- images 列は init_schema で text[] check(array_length(images,1) <= 3) として既に存在するので alter table 不要。
