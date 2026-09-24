-- Attachments for moderator edits of both passed and blocked road records.
alter table public.disaster_passed_roads
  add column if not exists image_urls jsonb not null default '[]'::jsonb,
  add column if not exists source_urls jsonb not null default '[]'::jsonb;

alter table public.disaster_passed_roads
  add constraint disaster_road_image_urls_array check (jsonb_typeof(image_urls) = 'array' and jsonb_array_length(image_urls) <= 3),
  add constraint disaster_road_source_urls_array check (jsonb_typeof(source_urls) = 'array' and jsonb_array_length(source_urls) <= 3);

-- The upload API re-encodes raster images as JPEG and strips metadata.
-- Public download only; no anon/authenticated insert/update/delete policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('disaster-road-images', 'disaster-road-images', true, 1048576, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column public.disaster_passed_roads.image_urls is 'Moderator supplied image URLs, up to 3. Uploads use disaster-road-images.';
comment on column public.disaster_passed_roads.source_urls is 'Moderator supplied source links, up to 3 HTTP(S) URLs.';
