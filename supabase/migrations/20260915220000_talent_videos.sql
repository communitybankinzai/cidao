-- 紹介動画の本番の仕組み（2026-09-15 中司さん決定：自動作成まで一気に作る）。
-- 流れ：写真の登録（顔の見せ方つき）→ AI が紹介文から台本・型・声・曲の気分を選ぶ（曲はその気分の中から無作為）
--   → GitHub Actions＋VOICEVOX が作る → 本人が確認して承認 → 運営が掲載 → 紹介ページで再生・保存。
-- 自己紹介（プロフィールの公開）や写真が変わるたびに自動で作り直す。書き込みはすべてサーバー（service_role）。

-- 顔の見せ方（photo＝そのまま／no_face＝顔を出さない・手元と作品の型）。イラスト風は運営の手作業なので後で足す
alter table public.talent_profiles add column if not exists face_mode text not null default 'photo'
  check (face_mode in ('photo','no_face'));

-- 本人が動画用に登録した写真（元ファイルは非公開バケット。EXIF は保存時に落とす）
create table if not exists public.talent_photos (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  path text not null unique,
  width int, height int, bytes int,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists talent_photos_member on public.talent_photos(member_id, sort);

create table if not exists public.talent_videos (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  profile_id uuid not null references public.talent_profiles(id),
  version_id uuid not null references public.talent_profile_versions(id),
  status text not null default 'queued'
    check (status in ('queued','rendering','owner_review','owner_approved','published','failed','retired')),
  style text not null check (style in ('oshare','cool','hands')),
  face_mode text not null check (face_mode in ('photo','no_face')),
  voice_name text not null, voice_speaker int not null, voice_speed numeric not null default 1.0,
  bgm_mood text not null, bgm_file text not null, bgm_credit text not null,
  script_json jsonb not null,          -- 場面ごとの見出し・読み上げ文・字幕・写真の path
  script_run_id uuid,                  -- 台本を作った AI 呼び出し（api_usage.run_id）
  trigger text not null default 'manual' check (trigger in ('manual','profile_published','photos_changed')),
  storage_path text, thumb_path text, duration_sec numeric, size_bytes bigint,
  error text,
  claimed_at timestamptz, rendered_at timestamptz,
  owner_approved_at timestamptz, owner_comment text check (char_length(owner_comment) <= 1000),
  admin_published_by uuid references public.members(id), published_at timestamptz, retired_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists talent_videos_member on public.talent_videos(member_id, created_at desc);
create index if not exists talent_videos_queue on public.talent_videos(status, created_at) where status in ('queued','rendering');
-- 同時に作るのは1人1本、掲載中も1人1本
create unique index if not exists talent_videos_one_active on public.talent_videos(member_id) where status in ('queued','rendering');
create unique index if not exists talent_videos_one_published on public.talent_videos(member_id) where status = 'published';
drop trigger if exists set_talent_videos_updated_at on public.talent_videos;
create trigger set_talent_videos_updated_at before update on public.talent_videos
  for each row execute function public.set_updated_at();

-- 読める人：本人（自分の分）と運営。紹介ページの再生は、公開範囲を確かめたサーバーが署名付き URL を出す
alter table public.talent_photos enable row level security;
alter table public.talent_videos enable row level security;
revoke all on public.talent_photos, public.talent_videos from anon, authenticated;
grant select on public.talent_photos, public.talent_videos to authenticated;
grant all on public.talent_photos, public.talent_videos to service_role;
drop policy if exists talent_photos_select on public.talent_photos;
create policy talent_photos_select on public.talent_photos for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists talent_videos_select on public.talent_videos;
create policy talent_videos_select on public.talent_videos for select to authenticated using (member_id = auth.uid() or public.is_admin());

-- 非公開バケット：talent-media（写真・動画・サムネイル）、talent-bgm（BGM。甘茶の音楽工房の利用規約で再配布不可のため公開リポジトリに置かない）
insert into storage.buckets (id, name, public, file_size_limit)
  values ('talent-media', 'talent-media', false, 104857600), ('talent-bgm', 'talent-bgm', false, 20971520)
  on conflict (id) do nothing;
-- storage.objects にはこの2バケット向けのポリシーを作らない＝anon/authenticated は触れず、service_role だけが読み書きする
