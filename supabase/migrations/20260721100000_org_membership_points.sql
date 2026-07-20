-- =============================================================
-- 団体所属の貢献度ポイント（承認時に一括30pt、1団体につき1回）
-- 2026-07-21 ユーザー決定：所属していることを評価し「けっこうつけて良い」
-- =============================================================

create or replace function public.award_on_membership_confirmed()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'confirmed' and new.left_at is null
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     -- 同じ団体への再加入・再承認では二重付与しない
     and not exists (
       select 1 from public.contributions
        where actor_id = new.member_id
          and action_type = 'org_membership'
          and related_id = new.org_id
     )
  then
    perform public.award_contribution(
      new.member_id, 'org_membership', 30, new.org_id, '団体所属（承認）'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_membership_confirmed_award on public.memberships;
create trigger trg_membership_confirmed_award
  after insert or update of status on public.memberships
  for each row execute function public.award_on_membership_confirmed();

-- 既存の承認済み所属への遡及付与（bot・削除済みメンバーは除外）
insert into public.contributions (actor_id, action_type, pt, related_id, reason)
select ms.member_id, 'org_membership', 30, ms.org_id, '団体所属（遡及付与）'
from public.memberships ms
join public.members m on m.id = ms.member_id and m.deleted_at is null
where ms.status = 'confirmed'
  and ms.left_at is null
  and not exists (
    select 1 from public.contributions c
     where c.actor_id = ms.member_id
       and c.action_type = 'org_membership'
       and c.related_id = ms.org_id
  );
