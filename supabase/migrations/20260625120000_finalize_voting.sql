-- =============================================================
-- 拘束的決議の有効性チェック（仕様§3.2.4）
-- 定足数: アクティブ verified 会員の 30% 以上の重み参加
-- 可決: 賛成重み合計 > 反対重み合計（過半数）
-- 諮問的（external）は参考扱いで status は変更しない（手動 closed のみ）
-- =============================================================

create or replace function public.finalize_voting(p_proposal_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal       proposals%rowtype;
  v_active_count   integer;
  v_total_weight   numeric;
  v_yes_weight     numeric;
  v_no_weight      numeric;
  v_quorum_weight  numeric;
  v_result         text;
begin
  select * into v_proposal from proposals where id = p_proposal_id;
  if not found or v_proposal.status <> 'voting' or v_proposal.voting_end_at > now() then
    return 'noop';
  end if;

  -- 諮問的は自動判定せず closed にだけ
  if v_proposal.binding_type = 'external' then
    update proposals set status = 'closed' where id = p_proposal_id;
    return 'closed_advisory';
  end if;

  -- アクティブ verified 会員数（6ヶ月以内アクティブ）
  select count(*) into v_active_count
    from members
   where tier = 'verified'
     and deleted_at is null
     and last_active_at > now() - interval '6 months';

  -- 当該提案の重み集計（verified 層のみが定足数対象）
  select coalesce(sum(weight_total), 0) into v_total_weight
    from vote_aggregates
   where proposal_id = p_proposal_id and tier = 'verified';

  select coalesce(sum(weight_total), 0) into v_yes_weight
    from vote_aggregates
   where proposal_id = p_proposal_id and tier = 'verified' and choice = '賛成';

  select coalesce(sum(weight_total), 0) into v_no_weight
    from vote_aggregates
   where proposal_id = p_proposal_id and tier = 'verified' and choice = '反対';

  -- 定足数 = アクティブ verified の 30% の重み（verified は重み 1.0 なので人数換算）
  v_quorum_weight := v_active_count * 0.3;

  if v_total_weight < v_quorum_weight then
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
      'active_count', v_active_count,
      'total_weight', v_total_weight,
      'yes_weight', v_yes_weight,
      'no_weight', v_no_weight,
      'quorum_weight', v_quorum_weight
    )
  );

  return v_result;
end;
$$;

-- ===========================
-- 提案の議論期間 → 投票期間自動遷移
-- discussion_start_at + 48h で投票期間開始
-- ===========================
create or replace function public.start_voting_if_due(p_proposal_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal     proposals%rowtype;
  v_voting_days  integer;
begin
  select * into v_proposal from proposals where id = p_proposal_id;
  if not found or v_proposal.status <> 'discussion' then
    return 'noop';
  end if;
  if v_proposal.discussion_start_at + interval '48 hours' > now() then
    return 'noop';
  end if;

  v_voting_days := case v_proposal.budget_size
    when 'small'  then 3
    when 'medium' then 7
    when 'large'  then 14
  end;

  update proposals
     set status          = 'voting',
         voting_start_at = now(),
         voting_end_at   = now() + (v_voting_days || ' days')::interval
   where id = p_proposal_id;

  return 'voting_started';
end;
$$;
