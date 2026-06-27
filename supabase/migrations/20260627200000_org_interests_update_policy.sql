-- =============================================================
-- Fix: org_interests had no UPDATE policy, so the server action's
-- write-back of email_sent_at / email_error was silently rejected
-- by RLS — leaving both columns NULL even after a Resend attempt.
-- This prevents diagnosis when email delivery fails.
-- =============================================================

create policy org_interests_update_self
  on public.org_interests for update
  to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());
