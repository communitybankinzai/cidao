-- =============================================================
-- direct_notices — 運営から会員へ「1人ずつ」送ったお知らせの記録（2026-11-07）
--
-- 背景: 管理画面のお知らせは全員宛ての一斉配信だけで、特定の会員に声かけする手段が無かった。
--       /admin/members から1人を選んで送れるようにし、いつ・誰が・誰に・何を送ったかをここに残す。
--       読まれたかどうかは notification_id で notifications.read_at を引いて表示する。
--
-- 送信そのもの（ベル🔔＋Webプッシュ）は既存の insertNotification を使う。
-- この表は記録だけで、読めるのも書けるのも運営（is_admin）だけ。会員本人には見せない。
--
-- purpose:
--   invite  = 活動のお誘い・お知らせ。会員が「CBIからの連絡を許可」している場合だけ送れる（サーバー側で判定）
--   support = 手続き・サポートの連絡。登録のお手伝いなど本人の手続きに関わるもの。許可に関係なく送れる
--
-- 2026-10-30 以降の新テーブルは Data API の権限が自動で付かないため、3つのロール分を明示する。
-- =============================================================

create table if not exists public.direct_notices (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.members(id) on delete cascade,
  sent_by         uuid references public.members(id) on delete set null,
  purpose         text not null check (purpose in ('invite', 'support')),
  title           text not null check (char_length(title) between 1 and 200),
  body            text check (body is null or char_length(body) <= 1000),
  link_url        text check (link_url is null or char_length(link_url) <= 300),
  notification_id uuid references public.notifications(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_direct_notices_created
  on public.direct_notices(created_at desc);

create index if not exists idx_direct_notices_recipient
  on public.direct_notices(recipient_id, created_at desc);

alter table public.direct_notices enable row level security;

-- Supabase の既定で authenticated / service_role に全権限が自動で付くことがあるため、いったん外してから必要な分だけ付ける
revoke all on public.direct_notices from anon;
revoke all on public.direct_notices from authenticated;
grant select, insert on public.direct_notices to authenticated;
grant select, insert, update, delete on public.direct_notices to service_role;

drop policy if exists direct_notices_select_admin on public.direct_notices;
create policy direct_notices_select_admin
  on public.direct_notices for select
  to authenticated
  using (public.is_admin());

drop policy if exists direct_notices_insert_admin on public.direct_notices;
create policy direct_notices_insert_admin
  on public.direct_notices for insert
  to authenticated
  with check (public.is_admin());

comment on table public.direct_notices is
  '運営から会員へ1人ずつ送ったお知らせの記録。運営（is_admin）だけが読み書きできる。送信は insertNotification、記録はここ';
