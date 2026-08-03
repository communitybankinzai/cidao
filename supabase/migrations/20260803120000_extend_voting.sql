-- =============================================================
-- 運営（管理者）による投票期間の延長・諮問の再開（2026-08-03）
--
--   対象: status='voting' の提案（締切を後ろへ延長）、
--         または status='closed' かつ binding_type='external' の提案
--         （諮問で集計済 → 投票中に戻して締切を再設定）。
--   可決(passed)・否決(rejected)は決定済みの結果を覆さないため対象外。
--   新しい締切は p_new_end の 23:59:59（JST）。
--   実行は is_admin() が真の会員のみ。結果は audit_logs に記録する。
-- =============================================================

create or replace function public.extend_voting(p_proposal_id uuid, p_new_end date)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal proposals%rowtype;
  v_end      timestamptz;
begin
  if not public.is_admin() then
    return 'error:not_admin';
  end if;

  select * into v_proposal from proposals where id = p_proposal_id;
  if not found then
    return 'error:not_found';
  end if;

  if v_proposal.status <> 'voting'
     and not (v_proposal.status = 'closed' and v_proposal.binding_type = 'external') then
    return 'error:not_extendable';
  end if;

  v_end := ((p_new_end + 1)::timestamp - interval '1 second') at time zone 'Asia/Tokyo';

  if v_end <= now() then
    return 'error:past_date';
  end if;
  if v_proposal.status = 'voting' and v_end <= v_proposal.voting_end_at then
    return 'error:not_later';
  end if;

  update proposals
     set status        = 'voting',
         voting_end_at = v_end
   where id = p_proposal_id;

  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, detail)
  values (
    'admin',
    auth.uid(),
    'extend_voting',
    'proposals',
    p_proposal_id,
    jsonb_build_object(
      'prev_status', v_proposal.status,
      'prev_end',    v_proposal.voting_end_at,
      'new_end',     v_end
    )
  );

  return 'extended';
end;
$$;

grant execute on function public.extend_voting(uuid, date) to authenticated;
