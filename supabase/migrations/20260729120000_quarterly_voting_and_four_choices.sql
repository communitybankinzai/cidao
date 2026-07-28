-- =============================================================
-- 投票の4択化 ＋ 投票締切の四半期デフォルト化（2026-07-29）
--
--   選択肢（全 binding_type 共通）:
--     大賛成 = 是非協力したい / 賛成 = でも協力は難しい
--     無理   = 実現は無理そう / 反対 = 良いと思わない
--   可決判定: (大賛成 + 賛成) の重み合計 > (無理 + 反対) の重み合計
--   締切: proposals.voting_deadline_override があればその日の 23:59:59(JST)、
--         未指定なら投票開始が属する四半期の末日 23:59:59(JST)
--
-- 既存の投票データ（賛成/反対/保留/協力できる/難しい/わからない）は書き換えない。
-- 「賛成」「反対」は文字列が一致するのでそのまま新判定に載る。
-- 「保留」「協力できる」「難しい」「わからない」は賛否には数えず、
-- 定足数（総重み）にのみカウントされる。
-- =============================================================

-- ===========================
-- 提案ごとの締切上書き（任意）
-- ===========================
alter table public.proposals
  add column if not exists voting_deadline_override date;

comment on column public.proposals.voting_deadline_override is
  '提案者が指定した投票締切日（JST）。null なら投票開始が属する四半期の末日。';

-- ===========================
-- 四半期末（JST 23:59:59）を返す
-- 暦四半期 = 1-3 / 4-6 / 7-9 / 10-12（区切りは 3/31・6/30・9/30・12/31）
-- ===========================
create or replace function public.quarter_end_at(p_from timestamptz default now())
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (
    date_trunc('quarter', (p_from at time zone 'Asia/Tokyo'))
      + interval '3 months' - interval '1 second'
  ) at time zone 'Asia/Tokyo';
$$;

grant execute on function public.quarter_end_at(timestamptz) to anon, authenticated, service_role;

-- ===========================
-- 議論期間 → 投票期間の自動遷移
-- 締切は budget_size ではなく override / 四半期末で決める
-- ===========================
create or replace function public.start_voting_if_due(p_proposal_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal proposals%rowtype;
  v_end      timestamptz;
begin
  select * into v_proposal from proposals where id = p_proposal_id;
  if not found or v_proposal.status <> 'discussion' then
    return 'noop';
  end if;
  if v_proposal.discussion_start_at + interval '48 hours' > now() then
    return 'noop';
  end if;

  if v_proposal.voting_deadline_override is not null then
    -- 指定日の 23:59:59（JST）
    v_end := ((v_proposal.voting_deadline_override + 1)::timestamp - interval '1 second')
             at time zone 'Asia/Tokyo';
  end if;

  -- 未指定、または指定日が既に過ぎている場合は四半期末にフォールバック
  if v_end is null or v_end <= now() then
    v_end := public.quarter_end_at(now());
  end if;

  update proposals
     set status          = 'voting',
         voting_start_at = now(),
         voting_end_at   = v_end
   where id = p_proposal_id;

  return 'voting_started';
end;
$$;

-- ===========================
-- 拘束的決議の有効性チェック（4択対応）
-- 定足数: アクティブ verified 会員の 30% 以上の重み参加
-- 可決:   大賛成+賛成 の重み > 無理+反対 の重み
-- 諮問的（external）は参考扱いで status は変更しない（closed のみ）
-- ===========================
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
   where proposal_id = p_proposal_id and tier = 'verified'
     and choice in ('大賛成', '賛成');

  select coalesce(sum(weight_total), 0) into v_no_weight
    from vote_aggregates
   where proposal_id = p_proposal_id and tier = 'verified'
     and choice in ('無理', '反対');

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
