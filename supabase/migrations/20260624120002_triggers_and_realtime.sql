-- =============================================================
-- CiDAO トリガー・関数・Realtime 設定
-- =============================================================

-- ===========================
-- auth.users 作成時に public.members を自動作成
-- ===========================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_residency residency_type;
  v_display_name text;
begin
  v_residency := coalesce(
    (new.raw_user_meta_data ->> 'residency_type')::residency_type,
    'citizen'
  );
  v_display_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    split_part(new.email, '@', 1)
  );

  insert into public.members (id, display_name, residency_type, tier)
  values (new.id, v_display_name, v_residency, 'light')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================
-- last_active_at 更新（軽量、proposals/votes/comments のみ）
-- ===========================
create or replace function public.touch_last_active()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := case tg_table_name
    when 'votes' then new.voter_id
    when 'comments' then new.author_id
    when 'proposals' then new.proposer_id
    else null
  end;

  if v_actor is not null then
    update public.members set last_active_at = now() where id = v_actor;
  end if;
  return new;
end;
$$;

create trigger trg_touch_active_votes
  after insert on public.votes
  for each row execute function public.touch_last_active();

create trigger trg_touch_active_comments
  after insert on public.comments
  for each row execute function public.touch_last_active();

create trigger trg_touch_active_proposals
  after insert on public.proposals
  for each row execute function public.touch_last_active();

-- ===========================
-- 投票重み計算（tier + residency_type から導出）
-- 仕様§3.1.3 配点：
--   light:      0.1  (citizen / related)
--   email_only: 0.3 / 0.15
--   verified:   1.0 / 0.5
-- ===========================
create or replace function public.calc_vote_weight()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_tier member_tier;
  v_res residency_type;
begin
  select tier, residency_type into v_tier, v_res
    from public.members where id = new.voter_id;

  new.weight := case v_tier
    when 'light'      then 0.1
    when 'email_only' then case v_res when 'citizen' then 0.3 else 0.15 end
    when 'verified'   then case v_res when 'citizen' then 1.0 else 0.5 end
  end;
  return new;
end;
$$;

create trigger trg_calc_vote_weight
  before insert or update of voter_id on public.votes
  for each row execute function public.calc_vote_weight();

-- ===========================
-- 貢献度ポイント自動付与
-- 仕様§3.4.1 配点表に従って actions ごとに INSERT
-- ===========================
create or replace function public.award_contribution(
  p_actor uuid, p_action text, p_pt integer, p_related uuid, p_reason text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.contributions (actor_id, action_type, pt, related_id, reason)
  values (p_actor, p_action, p_pt, p_related, p_reason);
end;
$$;

create or replace function public.award_on_vote()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_binding binding_type;
begin
  select binding_type into v_binding from public.proposals where id = new.proposal_id;
  perform public.award_contribution(
    new.voter_id,
    case v_binding when 'external' then 'voted_advisory' else 'voted_binding' end,
    case v_binding when 'external' then 2 else 3 end,
    new.proposal_id,
    null
  );
  return new;
end;
$$;

create trigger trg_award_on_vote
  after insert on public.votes
  for each row execute function public.award_on_vote();

create or replace function public.award_on_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.award_contribution(
    new.author_id,
    case new.kind
      when 'question' then 'question_posted'
      when 'answer'   then 'question_answered'
      else 'comment_posted'
    end,
    case new.kind
      when 'question' then 2
      when 'answer'   then 3
      else 1
    end,
    new.proposal_id,
    null
  );
  return new;
end;
$$;

create trigger trg_award_on_comment
  after insert on public.comments
  for each row execute function public.award_on_comment();

create or replace function public.award_on_proposal()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'discussion' and (old is null or old.status = 'draft') then
    perform public.award_contribution(new.proposer_id, 'proposal_posted', 30, new.id, null);
  elsif new.status = 'passed' and (old is null or old.status <> 'passed') then
    perform public.award_contribution(new.proposer_id, 'proposal_passed', 50, new.id, null);
  end if;
  return new;
end;
$$;

create trigger trg_award_on_proposal
  after insert or update of status on public.proposals
  for each row execute function public.award_on_proposal();

create or replace function public.award_on_event_attendance()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.attended = true and (old is null or old.attended is distinct from true) then
    perform public.award_contribution(
      new.member_id,
      case new.role
        when 'organizer' then 'event_hosted'
        when 'staff'     then 'event_staff'
        else 'event_attended'
      end,
      case new.role
        when 'organizer' then 40
        when 'staff'     then 20
        else 5
      end,
      new.event_id,
      null
    );
  end if;
  return new;
end;
$$;

create trigger trg_award_on_event_attendance
  after insert or update of attended on public.event_participants
  for each row execute function public.award_on_event_attendance();

create or replace function public.award_on_freefree_post()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'active' and (old is null or old.status <> 'active') then
    -- poster が member の場合のみ加点
    if new.poster_type = 'member' then
      perform public.award_contribution(new.poster_id, 'freefree_posted', 5, new.id, null);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_award_on_freefree_post
  after insert or update of status on public.freefree_posts
  for each row execute function public.award_on_freefree_post();

create or replace function public.award_on_coupon_use()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.award_contribution(new.member_id, 'freefree_coupon_used', 5, new.coupon_id, null);
  return new;
end;
$$;

create trigger trg_award_on_coupon_use
  after insert on public.coupon_uses
  for each row execute function public.award_on_coupon_use();

create or replace function public.award_on_support()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.award_contribution(new.member_id, 'freefree_support', 1, new.post_id, null);
  return new;
end;
$$;

create trigger trg_award_on_support
  after insert on public.supports
  for each row execute function public.award_on_support();

-- ===========================
-- vote_aggregates 更新（投票毎にインクリメンタル）
-- ===========================
create or replace function public.update_vote_aggregate()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_tier member_tier;
begin
  select tier into v_tier from public.members where id = new.voter_id;

  insert into public.vote_aggregates (proposal_id, tier, choice, count, weight_total, updated_at)
  values (new.proposal_id, v_tier, new.choice, 1, new.weight, now())
  on conflict (proposal_id, tier, choice) do update
    set count        = vote_aggregates.count + 1,
        weight_total = vote_aggregates.weight_total + new.weight,
        updated_at   = now();
  return new;
end;
$$;

create trigger trg_update_vote_aggregate
  after insert on public.votes
  for each row execute function public.update_vote_aggregate();

-- ===========================
-- Realtime 配信対象テーブル設定
-- ===========================
-- 投票結果・コメント・提案ステータスを即時反映するために
-- supabase_realtime publication に追加
alter publication supabase_realtime add table
  public.proposals,
  public.vote_aggregates,
  public.comments;
