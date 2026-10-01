-- SNS モニタ対象（Instagram アカウント）の一覧。
-- 2026-10-01 中司さん指示：登録したアカウントがイベントを告知したら自動でイベント（下書き候補）に入れる。
--   - CiDAO に登録されている団体 … organizations.sns_links.instagram（団体編集で運営・代表が追加。団体ページにリンク表示）
--   - 登録されない企業・行政 … この表（管理画面「SNS モニタ対象」で運営が追加・停止・削除）
-- cron（/api/cron/instagram-events-sync・service_role）が両方を読み、last_checked_at / last_error を書き戻す。

create table if not exists public.sns_monitor_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'instagram' check (platform in ('instagram')),
  username text not null,                               -- @ なしのユーザー名（例: inzai_shokokai）
  label text not null default '',                       -- 表示名（例: 印西市商工会）
  kind text not null default 'その他' check (kind in ('団体', '企業', '行政', 'その他')),
  org_id uuid references public.organizations(id) on delete set null,  -- 団体に紐づく場合（任意）
  enabled boolean not null default true,
  note text not null default '',
  last_checked_at timestamptz,
  last_error text,                                      -- 直近の取得エラー（無ければ null）
  last_post_at timestamptz,                             -- 直近に見た投稿の日時
  created_by uuid references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, username)
);
create index if not exists idx_sns_monitor_accounts_enabled on public.sns_monitor_accounts(enabled, platform);

alter table public.sns_monitor_accounts enable row level security;
revoke all on public.sns_monitor_accounts from anon, authenticated;
grant select, insert, update, delete on public.sns_monitor_accounts to authenticated;
grant all on public.sns_monitor_accounts to service_role;

drop policy if exists sns_monitor_accounts_admin_select on public.sns_monitor_accounts;
create policy sns_monitor_accounts_admin_select on public.sns_monitor_accounts for select to authenticated using (public.is_admin());
drop policy if exists sns_monitor_accounts_admin_insert on public.sns_monitor_accounts;
create policy sns_monitor_accounts_admin_insert on public.sns_monitor_accounts for insert to authenticated with check (public.is_admin());
drop policy if exists sns_monitor_accounts_admin_update on public.sns_monitor_accounts;
create policy sns_monitor_accounts_admin_update on public.sns_monitor_accounts for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists sns_monitor_accounts_admin_delete on public.sns_monitor_accounts;
create policy sns_monitor_accounts_admin_delete on public.sns_monitor_accounts for delete to authenticated using (public.is_admin());

comment on table public.sns_monitor_accounts is 'Instagram のイベント告知を自動で候補にするモニタ対象（企業・行政など CiDAO に登録されないアカウント）';
