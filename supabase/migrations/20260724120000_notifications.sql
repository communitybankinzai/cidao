-- =============================================================
-- notifications — アプリ内通知（ヘッダー🔔ベル）
-- 提案へのコメント・投票などのアクション発生時に、関係メンバーへ
-- 1行ずつ挿入する。挿入は Server Action が service_role で行い、
-- 本人（recipient）は閲覧と既読化のみ可能。
--
-- Semantics
--   recipient_id = 通知の宛先（members.id）
--   actor_id     = アクションを起こした人（表示用、削除時はNULL化）
--   kind         = 'comment' | 'vote' | 'proposal' | 'system'
--   link_url     = タップで遷移するアプリ内パス（例: /proposals/xxx）
--   read_at      = 既読日時（NULL = 未読）
-- =============================================================

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.members(id) on delete cascade,
  actor_id      uuid references public.members(id) on delete set null,
  kind          text not null check (kind in ('comment', 'vote', 'proposal', 'system')),
  title         text not null check (char_length(title) between 1 and 200),
  body          text,
  link_url      text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_notifications_recipient on public.notifications(recipient_id, created_at desc);
create index idx_notifications_unread on public.notifications(recipient_id) where read_at is null;

alter table public.notifications enable row level security;

-- SELECT: 本人のみ
create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (recipient_id = auth.uid());

-- UPDATE: 本人のみ（既読化）
create policy notifications_update_own
  on public.notifications for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- INSERT/DELETE は service_role のみ（ポリシーなし = RLSで遮断、service_roleはバイパス）

-- テーブルレベル権限（RLSとは別に必要。bug_reportsでの permission denied の教訓）
grant select, update on public.notifications to authenticated;
