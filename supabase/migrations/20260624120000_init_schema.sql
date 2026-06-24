-- =============================================================
-- CiDAO 初期スキーマ
-- 仕様書: site/admin/proposals/cidao-specification-v2.0-full.html
-- 設計方針:
--   - PII（住所・氏名・電話）は public.members には保持しない
--     → Supabase Auth user_metadata に隔離（決定 5c）
--   - public.members.id は auth.users.id と一致（1:1）
--   - ENUMs は安定する状態系のみ。動的に増えるリストは TEXT + CHECK
--   - Realtime/RLS/triggers は別 migration で
-- =============================================================

-- ===========================
-- Extensions
-- ===========================
create extension if not exists "pgcrypto";       -- gen_random_uuid()
create extension if not exists "pg_trgm";        -- 検索用 trigram

-- ===========================
-- Helper functions
-- ===========================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================
-- ENUM 型
-- ===========================
create type residency_type as enum ('citizen', 'related_population');
create type member_tier    as enum ('light', 'email_only', 'verified');
create type binding_type   as enum ('internal', 'hosted', 'external');
create type budget_size    as enum ('small', 'medium', 'large');
create type proposal_status as enum ('draft', 'discussion', 'voting', 'closed', 'passed', 'rejected');
create type organization_type as enum ('voluntary', 'civic', 'company', 'government');
create type membership_role as enum ('representative', 'officer', 'member');
create type membership_status as enum ('claimed', 'confirmed');
create type event_status as enum ('draft', 'open', 'closed', 'cancelled');
create type event_organizer_type as enum ('org', 'member');
create type event_participant_role as enum ('participant', 'staff', 'organizer');
create type comment_kind as enum ('question', 'answer', 'comment');
create type faq_source as enum ('ai', 'manual');
create type freefree_period as enum ('p_1week', 'p_1month', 'p_3months');
create type freefree_status as enum ('pending', 'active', 'expired', 'removed');
create type freefree_poster_type as enum ('member', 'org', 'individual_business');
create type support_kind as enum ('like', 'comment');
create type message_kind as enum ('request', 'consult', 'thanks', 'outreach');
create type sns_target_type as enum ('event', 'org', 'freefree');
create type sns_medium as enum ('x', 'facebook', 'line');
create type sns_status as enum ('success', 'failed', 'pending');
create type audit_actor_type as enum ('member', 'admin', 'system');
create type pr_message_acceptance as enum ('open', 'recommended_only', 'closed');
create type pr_public_scope as enum ('public', 'registered_only', 'consent_only');
create type admin_role as enum ('staff', 'committee', 'super');

-- ===========================
-- members（PII なし、auth.users 1:1）
-- ===========================
create table public.members (
  id                   uuid primary key references auth.users(id) on delete cascade,
  display_name         text not null check (char_length(display_name) between 1 and 40),
  residency_type       residency_type not null,
  relation_type        text,                       -- 関係人口の詳細
  tier                 member_tier not null default 'light',
  residence_verified_at timestamptz,               -- ハガキ受領日 → tier='verified'判定
  interests            text[] not null default '{}',  -- 興味分野（複数必須）
  preferred_activity_forms text[],
  preferred_activity_areas text[],
  self_introduction    text check (char_length(self_introduction) <= 400),
  skills_text          text,
  contact_permission   boolean not null default false,
  collaboration_consent boolean default false,
  contact_preferences  jsonb default '{}'::jsonb,
  public_settings      jsonb default '{}'::jsonb,  -- 項目別公開範囲
  ranking_opt_in       boolean not null default false,
  admin_role           admin_role,                 -- NULL=一般、staff/committee/super
  auth_provider_id     text not null default 'email',  -- v2.1: jpki等への拡張
  subject_id_hash      text,                       -- v2.1: AuthProvider 同一性確保
  last_active_at       timestamptz default now(),
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index idx_members_tier on public.members(tier);
create index idx_members_last_active on public.members(last_active_at);
create index idx_members_deleted_at on public.members(deleted_at) where deleted_at is null;
create trigger trg_members_updated before update on public.members
  for each row execute function public.set_updated_at();

-- ===========================
-- organizations & memberships
-- ===========================
create table public.organizations (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null check (char_length(name) between 1 and 100),
  type                        organization_type not null,
  inzai_registration_number   text unique,           -- 08-XXX、市民活動団体のみ
  description                 text,
  founded_at                  date,
  representative_id           uuid not null references public.members(id) on delete restrict,
  contact_email               text,
  contact_url                 text,
  accept_messages             boolean not null default true,
  public_flag                 boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index idx_organizations_type on public.organizations(type);
create index idx_organizations_public on public.organizations(public_flag) where public_flag = true;
create trigger trg_organizations_updated before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_categories (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  category    text not null,
  is_primary  boolean not null default false,
  primary key (org_id, category)
);
create index idx_org_cat_category on public.organization_categories(category);

create table public.memberships (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  role            membership_role not null default 'member',
  role_label      text,                              -- 自由記述役職名
  status          membership_status not null default 'claimed',
  approved_at     timestamptz,
  approved_by     uuid references public.members(id),
  display_in_org  boolean not null default false,
  note            text,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  primary key (org_id, member_id)
);
create index idx_memberships_member on public.memberships(member_id);
create index idx_memberships_status on public.memberships(status);

-- ===========================
-- proposals & votes
-- ===========================
create table public.proposals (
  id                  uuid primary key default gen_random_uuid(),
  proposer_id         uuid not null references public.members(id) on delete restrict,
  title               text not null check (char_length(title) between 1 and 60),
  body                text not null check (char_length(body) <= 2000),
  category            text not null,                  -- AI 自動分類カテゴリ
  binding_type        binding_type not null,
  budget_size         budget_size not null,
  implementation_date date not null,
  related_links       text[] check (array_length(related_links, 1) <= 3),
  status              proposal_status not null default 'draft',
  discussion_start_at timestamptz,
  voting_start_at     timestamptz,
  voting_end_at       timestamptz,
  draft_saved_at      timestamptz,                    -- 7日で削除（バッチ）
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_proposals_status on public.proposals(status);
create index idx_proposals_category on public.proposals(category);
create index idx_proposals_proposer on public.proposals(proposer_id);
create index idx_proposals_voting_window on public.proposals(voting_start_at, voting_end_at)
  where status = 'voting';
create trigger trg_proposals_updated before update on public.proposals
  for each row execute function public.set_updated_at();

create table public.votes (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references public.proposals(id) on delete cascade,
  voter_id      uuid not null references public.members(id) on delete restrict,
  choice        text not null,                     -- 拘束的: 賛成/反対/保留 ／ 諮問的: 協力できる/難しい/わからない
  weight        numeric(5, 2) not null,
  cast_at       timestamptz not null default now(),
  retracted_at  timestamptz,                       -- 撤回（1回まで、v2.1 上書きで更新）
  unique (proposal_id, voter_id)
);
create index idx_votes_proposal on public.votes(proposal_id);
create index idx_votes_voter on public.votes(voter_id);

create table public.vote_aggregates (
  proposal_id     uuid not null references public.proposals(id) on delete cascade,
  tier            member_tier not null,
  choice          text not null,
  count           integer not null default 0,
  weight_total    numeric(10, 2) not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (proposal_id, tier, choice)
);

-- ===========================
-- comments & faqs
-- ===========================
create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposals(id) on delete cascade,
  author_id    uuid not null references public.members(id) on delete restrict,
  kind         comment_kind not null,
  parent_id    uuid references public.comments(id) on delete cascade,
  recipient_id uuid references public.members(id),
  body         text not null check (char_length(body) >= 1),
  likes        integer not null default 0,
  created_at   timestamptz not null default now()
);
create index idx_comments_proposal on public.comments(proposal_id);
create index idx_comments_author on public.comments(author_id);
create index idx_comments_parent on public.comments(parent_id);

create table public.faqs (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposals(id) on delete cascade,
  question     text not null,
  answer       text not null,
  source       faq_source not null,
  approved_by  uuid references public.members(id),
  created_at   timestamptz not null default now()
);
create index idx_faqs_proposal on public.faqs(proposal_id);

-- ===========================
-- events
-- ===========================
create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null check (char_length(title) between 1 and 80),
  description           text not null,
  category              text not null,                 -- AI 自動分類
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  location              text,
  online_flag           boolean not null default false,
  capacity              integer check (capacity is null or capacity > 0),
  fee                   numeric(10, 0),
  organizer_type        event_organizer_type not null,
  organizer_id          uuid not null,                  -- members.id or organizations.id
  proxy_registration    boolean not null default false,
  proxy_source_url      text,                            -- 代理登録の出典必須
  recruitment_type      text[],
  status                event_status not null default 'draft',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_at >= start_at),
  check (not proxy_registration or proxy_source_url is not null)
);
create index idx_events_start on public.events(start_at);
create index idx_events_organizer on public.events(organizer_type, organizer_id);
create index idx_events_status on public.events(status);
create trigger trg_events_updated before update on public.events
  for each row execute function public.set_updated_at();

create table public.event_participants (
  event_id   uuid not null references public.events(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  role       event_participant_role not null default 'participant',
  joined_at  timestamptz not null default now(),
  attended   boolean,
  primary key (event_id, member_id)
);
create index idx_event_participants_member on public.event_participants(member_id);

-- ===========================
-- freefree
-- ===========================
create table public.freefree_posts (
  id            uuid primary key default gen_random_uuid(),
  poster_type   freefree_poster_type not null,
  poster_id     uuid not null,                          -- members.id or organizations.id or NULL(個人事業=members)
  title         text not null check (char_length(title) between 1 and 40),
  body          text not null check (char_length(body) <= 1000),
  category      text not null,
  location      text,
  images        text[] check (array_length(images, 1) <= 3),
  period        freefree_period not null,
  status        freefree_status not null default 'pending',
  expires_at    timestamptz,                             -- period から計算
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_freefree_status on public.freefree_posts(status);
create index idx_freefree_category on public.freefree_posts(category);
create index idx_freefree_poster on public.freefree_posts(poster_type, poster_id);
create index idx_freefree_expires on public.freefree_posts(expires_at) where status = 'active';
create trigger trg_freefree_updated before update on public.freefree_posts
  for each row execute function public.set_updated_at();

create table public.coupons (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.freefree_posts(id) on delete cascade,
  content      text not null,
  conditions   text,
  usage_limit  integer check (usage_limit is null or usage_limit > 0),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index idx_coupons_post on public.coupons(post_id);
create index idx_coupons_expires on public.coupons(expires_at);

create table public.coupon_uses (
  coupon_id  uuid not null references public.coupons(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  used_at    timestamptz not null default now(),
  primary key (coupon_id, member_id)
);

create table public.supports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.freefree_posts(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  kind        support_kind not null,
  body        text,
  created_at  timestamptz not null default now()
);
create index idx_supports_post on public.supports(post_id);
-- 1ユーザー1いいねまで（コメントは複数可）
create unique index idx_supports_unique_like
  on public.supports (post_id, member_id)
  where kind = 'like';

-- ===========================
-- messaging
-- ===========================
create table public.messages (
  id             uuid primary key default gen_random_uuid(),
  sender_id      uuid not null references public.members(id) on delete restrict,
  recipient_id   uuid not null references public.members(id) on delete restrict,
  kind           message_kind not null,
  subject        text not null check (char_length(subject) between 1 and 100),
  body           text not null,
  reply_deadline timestamptz,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index idx_messages_recipient on public.messages(recipient_id);
create index idx_messages_sender on public.messages(sender_id);

create table public.blocks (
  blocker_id  uuid not null references public.members(id) on delete cascade,
  blocked_id  uuid not null references public.members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ===========================
-- member_profiles_pr（人材バンク）
-- ===========================
create table public.member_profiles_pr (
  member_id           uuid primary key references public.members(id) on delete cascade,
  qualifications      text,
  interests_free_text text,
  contributions       text check (contributions is null or char_length(contributions) <= 600),
  available_times     text[],
  message_acceptance  pr_message_acceptance not null default 'recommended_only',
  public_scope        pr_public_scope not null default 'registered_only',
  updated_at          timestamptz not null default now()
);
create trigger trg_pr_updated before update on public.member_profiles_pr
  for each row execute function public.set_updated_at();

-- ===========================
-- contributions（貢献度ポイント履歴・監査兼用）
-- ===========================
create table public.contributions (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null references public.members(id) on delete cascade,
  action_type  text not null,
  pt           integer not null,
  reason       text,
  related_id   uuid,
  created_at   timestamptz not null default now()
);
create index idx_contributions_actor on public.contributions(actor_id);
create index idx_contributions_action on public.contributions(action_type);
create index idx_contributions_created on public.contributions(created_at);

-- ===========================
-- sns_post_logs & sns_rotation
-- ===========================
create table public.sns_post_logs (
  id            uuid primary key default gen_random_uuid(),
  target_type   sns_target_type not null,
  target_id     uuid not null,
  medium        sns_medium not null,
  posted_id     text,
  posted_at     timestamptz,
  status        sns_status not null default 'pending',
  impressions   integer,
  engagements   integer,
  error_message text,
  created_at    timestamptz not null default now()
);
create index idx_sns_logs_target on public.sns_post_logs(target_type, target_id);

create table public.sns_rotation (
  target_type          sns_target_type not null,
  target_id            uuid not null,
  category             text,
  last_spotlighted_at  timestamptz,
  primary key (target_type, target_id)
);

-- ===========================
-- audit_logs（改ざん耐性・hash chain は v2.1 で導入）
-- ===========================
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_type  audit_actor_type not null,
  actor_id    uuid references public.members(id),
  action      text not null,
  target_type text,
  target_id   uuid,
  detail      jsonb,
  ip_hash     text,
  timestamp   timestamptz not null default now()
);
create index idx_audit_actor on public.audit_logs(actor_id);
create index idx_audit_target on public.audit_logs(target_type, target_id);
create index idx_audit_timestamp on public.audit_logs(timestamp);

-- ===========================
-- 全テーブルで RLS を有効化（ポリシーは次の migration）
-- ===========================
alter table public.members              enable row level security;
alter table public.organizations        enable row level security;
alter table public.organization_categories enable row level security;
alter table public.memberships          enable row level security;
alter table public.proposals            enable row level security;
alter table public.votes                enable row level security;
alter table public.vote_aggregates      enable row level security;
alter table public.comments             enable row level security;
alter table public.faqs                 enable row level security;
alter table public.events               enable row level security;
alter table public.event_participants   enable row level security;
alter table public.freefree_posts       enable row level security;
alter table public.coupons              enable row level security;
alter table public.coupon_uses          enable row level security;
alter table public.supports             enable row level security;
alter table public.messages             enable row level security;
alter table public.blocks               enable row level security;
alter table public.member_profiles_pr   enable row level security;
alter table public.contributions        enable row level security;
alter table public.sns_post_logs        enable row level security;
alter table public.sns_rotation         enable row level security;
alter table public.audit_logs           enable row level security;
