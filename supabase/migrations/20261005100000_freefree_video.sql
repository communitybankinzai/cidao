-- FreeFree 掲載に動画を1本まで添付できるようにする（2026-10-05・事業主指示）。
--
-- 方針:
--   - 画像の images 列（text[]・最大3）には混ぜない。SNS の画像カード・一覧・OG 画像が images を
--     「画像」として読むため、動画の URL が入ると壊れる。動画は video_url（1本）に分ける。
--   - 保存先は動画専用の公開バケット freefree-videos。CBI は予算が無いので 1 本 20MB までに制限する。
--   - SNS（Threads・Instagram・Facebook）への投稿は従来どおり画像カードのまま。動画は掲載ページで再生するだけ。
--   - 権限は freefree-images と同じ思想: 公開読み取り＋ログイン済みがアップロード＋本人が削除＋運営が削除。

alter table public.freefree_posts add column if not exists video_url text;

alter table public.freefree_posts drop constraint if exists freefree_posts_video_url_len;
alter table public.freefree_posts
  add constraint freefree_posts_video_url_len check (video_url is null or char_length(video_url) <= 600);

comment on column public.freefree_posts.video_url is
  '掲載に添付した動画の公開URL（freefree-videos バケット・1本・20MBまで）。SNS には出さず掲載ページで再生する';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'freefree-videos',
  'freefree-videos',
  true,
  20971520, -- 20MB
  array['video/mp4', 'video/webm']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'freefree_videos_authenticated_upload'
  ) then
    create policy freefree_videos_authenticated_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'freefree-videos');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'freefree_videos_public_read'
  ) then
    create policy freefree_videos_public_read on storage.objects
      for select to public
      using (bucket_id = 'freefree-videos');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'freefree_videos_owner_delete'
  ) then
    create policy freefree_videos_owner_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'freefree-videos' and owner = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'freefree_videos_admin_delete'
  ) then
    create policy freefree_videos_admin_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'freefree-videos' and public.is_committee_or_super());
  end if;
end $$;
