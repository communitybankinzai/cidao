-- =============================================================
-- 修正: sync_vote_aggregate が INSERT で落ちる（2026-07-29）
--
-- 20260729150000 で入れた条件式
--     if tg_op = 'UPDATE' and old.retracted_at is null then
-- は、plpgsql が式を評価する前に old の値をパラメータとして解決しようとするため、
-- INSERT 時（old が未割り当て）に
--     record "old" is not assigned yet
-- で失敗する。AND の短絡評価は当てにできない。
--
-- old の参照を UPDATE 分岐の内側に閉じ込めて解消する。
-- =============================================================

create or replace function public.sync_vote_aggregate()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_tier member_tier;
begin
  select tier into v_tier from public.members where id = new.voter_id;
  if v_tier is null then
    return null;
  end if;

  -- 変更前の票を取り消す（UPDATE のときだけ old を触る）
  if tg_op = 'UPDATE' then
    if old.retracted_at is null then
      update public.vote_aggregates
         set count        = greatest(0, count - 1),
             weight_total = greatest(0, weight_total - old.weight),
             updated_at   = now()
       where proposal_id = old.proposal_id
         and tier        = v_tier
         and choice      = old.choice;
    end if;
  end if;

  -- 変更後の票を足す（撤回されていれば足さない）
  if new.retracted_at is null then
    insert into public.vote_aggregates (proposal_id, tier, choice, count, weight_total, updated_at)
    values (new.proposal_id, v_tier, new.choice, 1, new.weight, now())
    on conflict (proposal_id, tier, choice) do update
      set count        = vote_aggregates.count + 1,
          weight_total = vote_aggregates.weight_total + excluded.weight_total,
          updated_at   = now();
  end if;

  return null;
end;
$$;
