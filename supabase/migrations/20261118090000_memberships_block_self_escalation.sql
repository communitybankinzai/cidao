-- 会員が、自分の所属の行（memberships）を自分で「承認済み」や「代表者」に書き換えられる穴を塞ぐ（2026-11-18）。
--
-- 背景：RLS の memberships_update_self は「自分の行なら更新できる」とだけ決めていて、列を限っていない。
--       そのため、ログインした会員が API を直接呼べば、申告中の所属を自分で confirmed にしたり、
--       役割を representative に変えたりできた（団体ページの編集・団体名義の掲載ができてしまう）。
-- 対処：本人による更新のうち、次の変更を止める。画面からの正しい操作（表示の切り替え・脱退・再加入）は通す。
--   ・status を confirmed に変える（すでに confirmed の行はそのまま更新できる）
--   ・role を member 以外に変える
--   ・approved_at / approved_by を書き込む
--   ・org_id / member_id を付け替える
--   ・脱退済みの行を、承認済みのまま戻す（再加入は claimed に戻すこと）
-- 運営（is_admin）・その団体の代表者（is_org_representative）・サーバー側の処理（service_role。auth.uid() が無い）は対象外。

create or replace function public.memberships_block_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- サーバー側の処理（service_role・移行）は、だれの操作でもないので通す
  if v_uid is null then
    return new;
  end if;
  -- 本人以外の更新は、RLS（代表者・運営）に任せる
  if old.member_id <> v_uid then
    return new;
  end if;
  if public.is_admin() or public.is_org_representative(old.org_id) then
    return new;
  end if;

  if new.org_id <> old.org_id or new.member_id <> old.member_id then
    raise exception '所属の付け替えはできません' using errcode = '42501';
  end if;
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    raise exception '所属を自分で承認済みにはできません' using errcode = '42501';
  end if;
  if new.role <> old.role and new.role <> 'member' then
    raise exception '役割を自分で変えることはできません' using errcode = '42501';
  end if;
  if (new.approved_at is distinct from old.approved_at and new.approved_at is not null)
     or (new.approved_by is distinct from old.approved_by and new.approved_by is not null) then
    raise exception '承認の記録は書き換えられません' using errcode = '42501';
  end if;
  if old.left_at is not null and new.left_at is null and new.status = 'confirmed' then
    raise exception '再加入は申請からやり直してください' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_memberships_block_self_escalation on public.memberships;
create trigger trg_memberships_block_self_escalation
  before update on public.memberships
  for each row execute function public.memberships_block_self_escalation();
