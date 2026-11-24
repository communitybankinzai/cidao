-- 主催者の開催実績（/admin/organizers）の「似ている候補」で、「別の団体です」と記録した組み合わせ
-- 2026-11-24 事業主依頼：記録した組み合わせは、次から候補に出さない（取り消せる）。
--   key_a, key_b … 自動キー（src/lib/organizer-names.ts の organizerKey）。key_a < key_b に並べて1組1行
--   label_a, label_b … 記録したときの表示名（取り消し一覧の表示用）
--   decision_id … 1回の「別の団体です」で書いた行に共通の値（取り消しはこの単位）
-- 管理者だけが読み書きできる。2026-10-30 以降は新しいテーブルに自動で権限が付かないため、GRANT を明記する。

create table if not exists public.organizer_distinct_pairs (
  key_a       text not null,
  key_b       text not null,
  label_a     text not null check (char_length(label_a) between 1 and 200),
  label_b     text not null check (char_length(label_b) between 1 and 200),
  decision_id uuid not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  primary key (key_a, key_b),
  check (key_a < key_b)
);

comment on table public.organizer_distinct_pairs is
  '主催者名の「別の団体です」の記録。この組の自動キーは似ている候補に出さない。管理者のみ。';

create index if not exists organizer_distinct_pairs_decision_idx
  on public.organizer_distinct_pairs (decision_id);

alter table public.organizer_distinct_pairs enable row level security;

drop policy if exists organizer_distinct_pairs_select_admin on public.organizer_distinct_pairs;
create policy organizer_distinct_pairs_select_admin on public.organizer_distinct_pairs
  for select using (public.is_admin());

drop policy if exists organizer_distinct_pairs_insert_admin on public.organizer_distinct_pairs;
create policy organizer_distinct_pairs_insert_admin on public.organizer_distinct_pairs
  for insert with check (public.is_admin());

drop policy if exists organizer_distinct_pairs_update_admin on public.organizer_distinct_pairs;
create policy organizer_distinct_pairs_update_admin on public.organizer_distinct_pairs
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists organizer_distinct_pairs_delete_admin on public.organizer_distinct_pairs;
create policy organizer_distinct_pairs_delete_admin on public.organizer_distinct_pairs
  for delete using (public.is_admin());

grant select on public.organizer_distinct_pairs to anon;
grant select, insert, update, delete on public.organizer_distinct_pairs to authenticated, service_role;
