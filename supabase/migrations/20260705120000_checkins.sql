-- =============================================================
-- checkins: 団体の QR 受付記録
-- 設計:
--   - 会員証 QR（/talent/<member_id>）を団体側がスキャンして受付を記録する
--   - event_id を指定した受付は既存の event_participants（出欠→pt付与）と併用
--   - purpose は団体が自由に決める受付名（例: 総会受付、ボランティア集合）
--   - 書込は server action（service_role）経由のみ。RLS は SELECT のみ許可
-- =============================================================

create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  event_id    uuid references public.events(id) on delete set null,
  purpose     text check (char_length(purpose) <= 60),
  scanned_by  uuid not null references public.members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- event か purpose のどちらかは必須
  check (event_id is not null or purpose is not null)
);

create index idx_checkins_org_created on public.checkins(org_id, created_at desc);
create index idx_checkins_member on public.checkins(member_id);

alter table public.checkins enable row level security;

-- 閲覧: 本人 / 当該団体の承認済みメンバー / 管理者
create policy checkins_select on public.checkins
  for select using (
    member_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.memberships m
      where m.org_id = checkins.org_id
        and m.member_id = auth.uid()
        and m.status = 'confirmed'
        and m.left_at is null
    )
  );

-- INSERT/UPDATE/DELETE ポリシーは意図的に作らない（service_role のみ書込可）
