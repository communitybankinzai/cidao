-- =============================================================
-- org_interests — talent-bank "interest" / soft application from a
-- registered member toward an organization. Lighter than membership.
-- =============================================================
-- Semantics
--   "memberships" (existing) = formal membership row, claim/approval state machine.
--   "org_interests" (new)    = "I'd like to help / get involved with this org" —
--                              a one-shot soft signal that triggers an email
--                              to the org's contact_email and is recorded so the
--                              org can review who has reached out.
--
-- Only registered members (tier != 'light') can submit. Members can view their
-- own past submissions; editors of the org can view all interests sent to them.
-- =============================================================

create table public.org_interests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete restrict,
  message         text not null check (char_length(message) between 1 and 400),
  contact_ok      boolean not null default true,
  email_sent_at   timestamptz,
  email_error     text,
  created_at      timestamptz not null default now()
);

create index idx_org_interests_org on public.org_interests(org_id, created_at desc);
create index idx_org_interests_member on public.org_interests(member_id, created_at desc);

alter table public.org_interests enable row level security;

-- INSERT: registered member (not light) inserting as themselves
create policy org_interests_insert_self
  on public.org_interests for insert
  to authenticated
  with check (
    member_id = auth.uid()
    and exists (
      select 1 from public.members m
      where m.id = auth.uid()
        and m.tier <> 'light'
        and m.deleted_at is null
    )
  );

-- SELECT: my own row, OR org editor
create policy org_interests_select_self_or_editor
  on public.org_interests for select
  to authenticated
  using (
    member_id = auth.uid()
    or exists (
      select 1 from public.organizations o
      where o.id = org_interests.org_id
        and public.can_edit_org(o)
    )
  );

-- DELETE: only the member who sent it (rescind)
create policy org_interests_delete_self
  on public.org_interests for delete
  to authenticated
  using (member_id = auth.uid());
