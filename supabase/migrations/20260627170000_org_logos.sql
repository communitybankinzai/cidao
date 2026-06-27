-- 団体ロゴ機能：organizations.logo_url 列 + org-logos Storage バケット
-- 既存 avatars / event-flyers バケットと同じパターン（public 読込・5MB上限・画像のみ）

-- 1. logo_url 列追加
alter table public.organizations
  add column logo_url text;

comment on column public.organizations.logo_url is
  '団体ロゴ画像の公開URL（Storage org-logos バケット）。'
  '代表者が /orgs/[id]/edit からアップロード。未設定時はUIで団体名先頭文字のモノグラム表示。';

-- 2. Storage バケット作成
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos',
  'org-logos',
  true,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. Storage RLS（DO で重複定義回避、event-flyers と同じ思想）
do $$
begin
  -- 認証ユーザーはアップロード可
  -- （アプリ層で can_edit_org() チェックして編集権者だけに upload action を提供する）
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'org_logos_authenticated_upload'
  ) then
    create policy org_logos_authenticated_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'org-logos');
  end if;

  -- 誰でも公開読み取り
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'org_logos_public_read'
  ) then
    create policy org_logos_public_read on storage.objects
      for select to public
      using (bucket_id = 'org-logos');
  end if;

  -- アップロードした本人 / 編集権者は更新・削除可（owner ベース、シンプル版）
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'org_logos_owner_update'
  ) then
    create policy org_logos_owner_update on storage.objects
      for update to authenticated
      using (bucket_id = 'org-logos' and owner = auth.uid())
      with check (bucket_id = 'org-logos' and owner = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'org_logos_owner_delete'
  ) then
    create policy org_logos_owner_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'org-logos' and owner = auth.uid());
  end if;
end $$;
