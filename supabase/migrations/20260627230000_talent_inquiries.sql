-- =============================================================
-- talent_inquiries — contact from one member toward a talent-bank
-- listing (member_profiles_pr 公開済みのメンバー). Lighter than
-- formal cooperation: a single message + email notification.
--
-- Semantics
--   from_member_id = sender (must be authenticated, tier != 'light')
--   to_member_id   = talent-bank listing owner (must have a public
--                    member_profiles_pr row, message_acceptance != 'closed')
--   message        = body text 1..600 chars
--   email_sent_at  = Resend send timestamp (NULL if not yet sent / failed)
--   email_error    = Resend error or pre-check failure (NULL on success)
-- =============================================================

create table public.talent_inquiries (
  id              uuid primary key default gen_random_uuid(),
  to_member_id    uuid not null references public.members(id) on delete restrict,
  from_member_id  uuid not null references public.members(id) on delete restrict,
  message         text not null check (char_length(message) between 1 and 600),
  email_sent_at   timestamptz,
  email_error     text,
  created_at      timestamptz not null default now()
);

create index idx_talent_inquiries_to on public.talent_inquiries(to_member_id, created_at desc);
create index idx_talent_inquiries_from on public.talent_inquiries(from_member_id, created_at desc);

alter table public.talent_inquiries enable row level security;

-- INSERT: registered (non-light) sender to themselves, target must be on talent bank
create policy talent_inquiries_insert_sender
  on public.talent_inquiries for insert
  to authenticated
  with check (
    from_member_id = auth.uid()
    and from_member_id <> to_member_id
    and exists (
      select 1 from public.members m
      where m.id = auth.uid()
        and m.tier <> 'light'
        and m.deleted_at is null
    )
    and exists (
      select 1 from public.member_profiles_pr p
      where p.member_id = to_member_id
        and p.message_acceptance <> 'closed'
    )
  );

-- SELECT: either party can see their own rows
create policy talent_inquiries_select_self
  on public.talent_inquiries for select
  to authenticated
  using (from_member_id = auth.uid() or to_member_id = auth.uid());

-- UPDATE: only the sender writes back email_sent_at / email_error
create policy talent_inquiries_update_sender
  on public.talent_inquiries for update
  to authenticated
  using (from_member_id = auth.uid())
  with check (from_member_id = auth.uid());

-- DELETE: only sender (rescind)
create policy talent_inquiries_delete_sender
  on public.talent_inquiries for delete
  to authenticated
  using (from_member_id = auth.uid());
