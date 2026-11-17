-- 提案の成立の数え方を直す（2026-11-18 事業主決定）。
--
-- これまで：定足数は「半年以内に動いた verified 会員の3割」、賛否も verified の票だけ。
--   verified は1名だけで、verified に上がる手段も無い。実際に投票しているのは email_only の会員なので、
--   票がいくら入っても、締切で必ず否決になっていた（投票中の4件が該当）。
-- これから：
--   ・数える対象は、投票できる会員全員（email_only と verified。退会した会員と light は除く。取り消した票は除く）
--   ・定足数は「3名以上が投票」（会員が増えたら見直す）
--   ・賛否は、これまでどおり「大賛成＋賛成 の重み」が「反対 の重み」を上回れば成立（保留などは賛否に数えない）
-- 参考の投票（binding_type='external'）は、これまでどおり成立・否決を付けずに締め切る。

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

  -- 投票できる会員（email_only・verified）の、取り消していない票だけを数える
  select count(distinct v.voter_id),
         coalesce(sum(v.weight), 0),
         coalesce(sum(v.weight) filter (where v.choice in ('大賛成', '賛成')), 0),
         coalesce(sum(v.weight) filter (where v.choice = '反対'), 0)
    into v_voter_count, v_total_weight, v_yes_weight, v_no_weight
    from votes v
    join members m on m.id = v.voter_id
   where v.proposal_id = p_proposal_id
     and v.retracted_at is null
     and m.deleted_at is null
     and m.tier in ('email_only', 'verified');

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
      'rule', 'min_voters_all_eligible_2026-11-18',
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
