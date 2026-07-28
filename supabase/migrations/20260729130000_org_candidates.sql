-- 団体候補（イベント主催名から拾った未登録の主催者）を管理画面で仮登録するための変更。
--
-- 1) 管理者が representative_id を空のまま団体を登録できるようにする
--    既存の orgs_insert_admin は representative_id = auth.uid() を要求していたため、
--    「代表者による更新待ち」の仮登録ができなかった。
-- 2) 団体ではない主催名（企業・行政・媒体名など）を除外リストに記録する

-- ===========================
-- 1) admin の INSERT ポリシー拡張
-- ===========================
drop policy if exists orgs_insert_admin on public.organizations;

create policy orgs_insert_admin on public.organizations
  for insert with check (
    public.is_admin()
    and (representative_id = auth.uid() or representative_id is null)
  );

-- ===========================
-- 2) 除外リスト
-- ===========================
create table if not exists public.org_name_exclusions (
  name        text primary key,
  reason      text,
  excluded_by uuid references public.members(id) on delete set null,
  excluded_at timestamptz not null default now()
);

comment on table public.org_name_exclusions is
  'イベント主催名のうち、市民活動団体として登録しないと判断した名称。団体候補一覧から除外される。';

alter table public.org_name_exclusions enable row level security;

-- 参照は管理者のみ（管理画面でしか使わない）
drop policy if exists org_name_exclusions_select_admin on public.org_name_exclusions;
create policy org_name_exclusions_select_admin on public.org_name_exclusions
  for select using (public.is_admin());

drop policy if exists org_name_exclusions_insert_admin on public.org_name_exclusions;
create policy org_name_exclusions_insert_admin on public.org_name_exclusions
  for insert with check (public.is_admin());

drop policy if exists org_name_exclusions_delete_admin on public.org_name_exclusions;
create policy org_name_exclusions_delete_admin on public.org_name_exclusions
  for delete using (public.is_admin());

grant select, insert, delete on public.org_name_exclusions to authenticated;
