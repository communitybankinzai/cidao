-- =============================================================
-- 悪質投稿への対応記録（証拠保全）
--
-- 背景:
--   運営が不適切な掲載を非公開／削除できるようにしたが、消すと同時に
--   「何が投稿されていたか」も失われる。被害届や捜査関係事項照会に応じる
--   必要が出たとき、手元に何も残っていない状態を避ける。
--
-- 方針:
--   1. 消す前に掲載内容を jsonb で凍結する（掲載行が消えても残る）
--   2. 画像は消す前に非公開バケット moderation-evidence へ複製する
--      （公開は止まるが現物は残る）
--   3. 誰がいつどの操作をしたかを併せて残す
--
-- 記録しないもの:
--   IPアドレス・User-Agent は現在アプリのどこでも取得しておらず、
--   新たに収集するにはプライバシーポリシーへの明記が要る。別途判断する。
--
-- ⚠ 要法務監修:
--   保存期間、警察への任意提出の可否、発信者情報の取扱いは法令に関わる。
--   本マイグレーションは「記録を残せるようにする」までで、開示の運用は定めない。
-- =============================================================

create table if not exists public.moderation_records (
  id            uuid primary key default gen_random_uuid(),
  -- 掲載は削除されうるので FK は張らない（消えたあとも記録を残すため）
  target_type   text not null default 'freefree',
  target_id     uuid not null,
  action        text not null check (action in ('hidden', 'restored', 'images_deleted', 'deleted')),
  reason        text,
  -- 掲載内容の凍結（title / body / category / location / images / created_at / poster_type / poster_id）
  snapshot      jsonb not null default '{}'::jsonb,
  -- 投稿者の識別子の凍結（display_name / auth_provider_id / member_created_at）
  -- メールアドレスは複製せず、必要時に auth.users から引く
  poster        jsonb not null default '{}'::jsonb,
  -- moderation-evidence バケットへ退避した画像のパス
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
  -- UPDATE / DELETE のポリシーは意図的に作らない（記録を後から書き換えられないようにする）
end $$;

grant select, insert on public.moderation_records to authenticated;
grant all on public.moderation_records to service_role;

-- ---------- 証拠画像の退避先（非公開バケット）
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
    -- 閲覧・保存とも committee / super のみ。公開読み取りポリシーは作らない
    create policy moderation_evidence_admin_all on storage.objects
      for all to authenticated
      using (bucket_id = 'moderation-evidence' and public.is_committee_or_super())
      with check (bucket_id = 'moderation-evidence' and public.is_committee_or_super());
  end if;
end $$;
