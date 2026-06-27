-- =============================================================
-- Fix: touch_last_active() fails on proposals INSERT
-- =============================================================
-- Symptom
--   INSERT INTO proposals (...) -> ERROR:  record "new" has no field "voter_id"
--   CONTEXT: PL/pgSQL assignment "v_actor := case tg_table_name when 'votes' then new.voter_id ..."
--           PL/pgSQL function touch_last_active() line 5 at assignment
--
-- Root cause
--   PL/pgSQL compiles every branch of a CASE expression at function-load time, so
--   referencing new.voter_id (a votes-only column) makes the function fail for any
--   table whose NEW record does not have a voter_id column, regardless of which
--   tg_table_name branch is actually taken.
--
-- Why it stayed hidden
--   Until 2026-06-27 no row had been inserted into public.proposals on production
--   (proposals count was 0 across all sessions). The first INSERT attempt by the
--   seed script surfaced the bug.
--
-- Fix
--   Replace the CASE expression with IF/ELSIF blocks so each NEW.* column is only
--   parsed in a branch matched by tg_table_name. Behaviour is identical.
-- =============================================================

create or replace function public.touch_last_active()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid;
begin
  if tg_table_name = 'votes' then
    v_actor := new.voter_id;
  elsif tg_table_name = 'comments' then
    v_actor := new.author_id;
  elsif tg_table_name = 'proposals' then
    v_actor := new.proposer_id;
  end if;

  if v_actor is not null then
    update public.members set last_active_at = now() where id = v_actor;
  end if;
  return new;
end;
$$;
