-- 主催者名の名寄せ表（管理画面 /admin/organizers 用）
-- 2026-11-24 事業主決定：events.organizer_name_text（自由入力）は書き換えず、「この表記は、この団体としてまとめる」という対応表だけを別に持つ。
--   alias_key      … 自動キー（src/lib/organizer-names.ts の organizerKey が作る、表記ゆれを落とした文字列）
--   canonical_name … まとめ先の表示名（同じ名前の行は同じ団体として数える）
--   org_id         … 登録団体（organizations）との対応。任意。
-- 管理者だけが読み書きできる（公開画面では使わない）。
-- 2026-10-30 以降は新しいテーブルに自動で権限が付かないため、GRANT を明記する。

create table if not exists public.organizer_aliases (
  alias_key      text primary key,
  canonical_name text not null check (char_length(canonical_name) between 1 and 200),
  org_id         uuid references public.organizations(id) on delete set null,
  created_at     timestamptz not null default now(),
  created_by     uuid
);

comment on table public.organizer_aliases is
  '主催者名の名寄せ表。alias_key（自動キー）→ canonical_name（まとめ先）。events.organizer_name_text は書き換えない。管理者のみ。';

create index if not exists organizer_aliases_canonical_idx
  on public.organizer_aliases (canonical_name);

alter table public.organizer_aliases enable row level security;

drop policy if exists organizer_aliases_select_admin on public.organizer_aliases;
create policy organizer_aliases_select_admin on public.organizer_aliases
  for select using (public.is_admin());

drop policy if exists organizer_aliases_insert_admin on public.organizer_aliases;
create policy organizer_aliases_insert_admin on public.organizer_aliases
  for insert with check (public.is_admin());

drop policy if exists organizer_aliases_update_admin on public.organizer_aliases;
create policy organizer_aliases_update_admin on public.organizer_aliases
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists organizer_aliases_delete_admin on public.organizer_aliases;
create policy organizer_aliases_delete_admin on public.organizer_aliases
  for delete using (public.is_admin());

grant select on public.organizer_aliases to anon;
grant select, insert, update, delete on public.organizer_aliases to authenticated, service_role;
