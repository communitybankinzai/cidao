-- =============================================================
-- CiDAO 提案の SNS 告知
--
-- 提案（proposals）が作成されたら SNS 告知の下書きを自動生成し、
-- 管理画面で承認して配信する（既存の sns_post_logs 承認フローに乗せる）。
-- あわせて媒体に Threads / Instagram を追加し、
-- 「承認を省略して即配信する」全自動モードの設定置き場を新設する。
--
-- 注意: enum の新値はこのトランザクション内では使用しない
-- （PostgreSQL の "unsafe use of new value" 制約）。
-- =============================================================

alter type sns_target_type add value if not exists 'proposal';
alter type sns_medium add value if not exists 'threads';
alter type sns_medium add value if not exists 'instagram';

-- 汎用アプリ設定（key-value）。まずは SNS 全自動フラグ用。
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(id)
);

comment on table public.app_settings is
  'サイト全体の運用設定。サーバー（service role）と管理画面から読み書きする。';
comment on column public.app_settings.value is
  'sns_auto_post の場合: {"enabled": boolean}。true なら提案告知を承認なしで即配信する。';

alter table public.app_settings enable row level security;

create policy app_settings_select_admin on public.app_settings
  for select using (public.is_admin());
create policy app_settings_insert_admin on public.app_settings
  for insert with check (public.is_admin());
create policy app_settings_update_admin on public.app_settings
  for update using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.app_settings to authenticated;

insert into public.app_settings (key, value)
values ('sns_auto_post', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;
