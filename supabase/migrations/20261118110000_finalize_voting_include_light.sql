-- 提案の成立の判定に、light の会員の票も入れる（2026-11-18 事業主決定「入れる」）。
--
-- 20261118100000 で「email_only と verified の票」を数える形にしたが、light の会員も投票できる設計だった
-- （castVote と votes の RLS に区分の条件は無く、票の重みは calc_vote_weight で 0.1 と決めてある）。
-- 投票できるのに結果に数えられない、という食い違いをなくす。
--   ・数える対象：退会していない会員全員（light・email_only・verified）。取り消した票は除く
--   ・定足数：3名以上が投票（light も人数に含む）
--   ・賛否：大賛成＋賛成 の重みが、反対 の重みを上回れば成立（重みは票に記録された値。light は 0.1）

create or replace function public.finalize_voting(p_proposal_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal      proposals%rowtype;
  v_min_voters    constant integer := 3;
  v_voter_count   integer;
  v_total_weight  numeric;
  v_yes_weight    numeric;
  v_no_weight     numeric;
  v_result        text;
begin
  select * into v_proposal from proposals where id = p_proposal_id;
  if not found or v_proposal.status <> 'voting' or v_proposal.voting_end_at > now() then
    return 'noop';
  end if;

  -- 参考の投票は自動判定せず closed にだけ
  if v_proposal.binding_type = 'external' then
    update proposals set status = 'closed' where id = p_proposal_id;
    return 'closed_advisory';
  end if;

  -- 退会していない会員の、取り消していない票を数える（区分は問わない）
  select count(distinct v.voter_id),
         coalesce(sum(v.weight), 0),
         coalesce(sum(v.weight) filter (where v.choice in ('大賛成', '賛成')), 0),
         coalesce(sum(v.weight) filter (where v.choice = '反対'), 0)
    into v_voter_count, v_total_weight, v_yes_weight, v_no_weight
    from votes v
    join members m on m.id = v.voter_id
   where v.proposal_id = p_proposal_id
     and v.retracted_at is null
     and m.deleted_at is null;

  if v_voter_count < v_min_voters then
    update proposals set status = 'rejected' where id = p_proposal_id;
    v_result := 'rejected_no_quorum';
  elsif v_yes_weight > v_no_weight then
    update proposals set status = 'passed' where id = p_proposal_id;
    v_result := 'passed';
  else
    update proposals set status = 'rejected' where id = p_proposal_id;
    v_result := 'rejected_no_majority';
  end if;

  -- 結果を audit_logs に記録
  insert into audit_logs (actor_type, action, target_type, target_id, detail)
  values (
    'system',
    'finalize_voting',
    'proposals',
    p_proposal_id,
    jsonb_build_object(
      'result', v_result,
      'rule', 'min_voters_all_members_2026-11-18',
      'voter_count', v_voter_count,
      'min_voters', v_min_voters,
      'total_weight', v_total_weight,
      'yes_weight', v_yes_weight,
      'no_weight', v_no_weight
    )
  );

  return v_result;
end;
$function$;
