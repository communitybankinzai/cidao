-- FreeFree 掲載の編集（2026-09-16）
-- 各事業主のPRを日に日に良いものへ更新できるよう、掲載後の編集を可能にする。
--
-- 1. 中身の最終更新日時 content_updated_at を追加（詳細ページの「◯月◯日更新」に使う）。
--    updated_at は運営の非表示操作などでも変わるため、表示には使わない
-- 2. 個人事業の掲載も本人が更新できるようにする（update ポリシーに individual_business が抜けていた）
-- 3. 掲載者が変えてよいのは中身だけ。状態・掲載者・運営の記録・作成日時は、
--    運営者（committee / super）とサーバー内部の処理しか変えられないようにする
--    （代理掲載の記録 proxy_posted_by は既存の trg_freefree_guard_proxy が守っている）
-- 4. 変更前の中身を残す履歴 freefree_post_revisions（運営者だけが読める）

alter table public.freefree_posts add column if not exists content_updated_at timestamptz;
comment on column public.freefree_posts.content_updated_at is
  '掲載者・運営が中身（タイトル・本文・画像・リンク等）を編集した最終日時。未編集は null';

drop policy if exists freefree_update_poster on public.freefree_posts;
create policy freefree_update_poster on public.freefree_posts
  for update using (
    (poster_type = 'member' and poster_id = auth.uid())
    or (poster_type = 'org' and public.is_org_member(poster_id))
    or (poster_type = 'individual_business' and poster_id = auth.uid())
  );

create or replace function public.guard_freefree_poster_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- サーバー内部の処理（service role 等で auth.uid() が無い）と運営者は対象外
  if auth.uid() is null or public.is_committee_or_super() then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.poster_type is distinct from old.poster_type
     or new.poster_id is distinct from old.poster_id
     or new.created_at is distinct from old.created_at
     or new.moderated_at is distinct from old.moderated_at
     or new.moderated_by is distinct from old.moderated_by
     or new.moderation_note is distinct from old.moderation_note then
    raise exception '掲載の状態・掲載者・運営の記録は運営者しか変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_freefree_guard_poster_update on public.freefree_posts;
create trigger trg_freefree_guard_poster_update
  before update on public.freefree_posts
  for each row execute function public.guard_freefree_poster_update();

create table if not exists public.freefree_post_revisions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.freefree_posts(id) on delete cascade,
  edited_by uuid,                              -- 編集した人（auth.uid()。サーバー内部の処理なら null）
  edited_at timestamptz not null default now(),
  old_content jsonb not null                   -- 変更前の中身
);
create index if not exists freefree_post_revisions_post_idx
  on public.freefree_post_revisions (post_id, edited_at desc);
comment on table public.freefree_post_revisions is
  'FreeFree 掲載の編集履歴（変更前の中身）。運営者だけが読める。書き込みはトリガーのみ';

alter table public.freefree_post_revisions enable row level security;
drop policy if exists freefree_revisions_select_operator on public.freefree_post_revisions;
create policy freefree_revisions_select_operator on public.freefree_post_revisions
  for select using (public.is_committee_or_super());
-- insert / update / delete のポリシーは作らない（下のトリガーだけが書き込む）

create or replace function public.record_freefree_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := jsonb_build_object(
    'title', old.title, 'body', old.body, 'category', old.category, 'location', old.location,
    'images', to_jsonb(old.images), 'links', old.links, 'expires_at', old.expires_at,
    'event_start_date', old.event_start_date, 'sns_share', old.sns_share,
    'sns_display_name', old.sns_display_name, 'metaverse_pin', old.metaverse_pin, 'address', old.address
  );
  v_new jsonb := jsonb_build_object(
    'title', new.title, 'body', new.body, 'category', new.category, 'location', new.location,
    'images', to_jsonb(new.images), 'links', new.links, 'expires_at', new.expires_at,
    'event_start_date', new.event_start_date, 'sns_share', new.sns_share,
    'sns_display_name', new.sns_display_name, 'metaverse_pin', new.metaverse_pin, 'address', new.address
  );
begin
  -- 中身が変わったときだけ残す（非表示・再表示など状態だけの変更では残さない）
  if v_old is distinct from v_new then
    insert into public.freefree_post_revisions (post_id, edited_by, old_content)
    values (old.id, auth.uid(), v_old);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_freefree_record_revision on public.freefree_posts;
create trigger trg_freefree_record_revision
  after update on public.freefree_posts
  for each row execute function public.record_freefree_revision();
