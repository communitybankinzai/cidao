-- =============================================================
-- push_subscriptions — Webプッシュ（PWA）の購読情報
-- ブラウザの PushManager.subscribe() の結果を1行ずつ保存する。
-- 送信は insertNotification（service_role）から web-push で行う。
--
-- - 1人が複数端末で購読できる（endpoint がユニークキー）
-- - 失効した購読（410 Gone）は送信時に service_role が削除する
-- =============================================================

create table public.push_subscriptions (
  endpoint    text primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index idx_push_subscriptions_member on public.push_subscriptions(member_id);

alter table public.push_subscriptions enable row level security;

-- 本人のみ購読の登録・確認・解除ができる
create policy push_subscriptions_select_own
  on public.push_subscriptions for select
  to authenticated
  using (member_id = auth.uid());

create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert
  to authenticated
  with check (member_id = auth.uid());

create policy push_subscriptions_update_own
  on public.push_subscriptions for update
  to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete
  to authenticated
  using (member_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
