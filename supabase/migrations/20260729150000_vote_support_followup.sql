-- =============================================================
-- 「大賛成」票の名乗り出し・提案者への連絡、および投票集計の穴の修正
-- （2026-07-29、3択化 20260729120000 とセットで適用する）
--
-- 1. 投票の変更・撤回が vote_aggregates に反映されない不具合の修正
-- 2. 投票を変更したとき weight が 0 で上書きされる不具合の修正
-- 3. votes.disclose_identity（大賛成のとき提案者に名乗るか）
-- 4. 提案者が「名乗り出た大賛成票」を読めるようにする RLS
-- 5. talent_inquiries.proposal_id ＋ 提案起点でメッセージを送れる RLS
--    （提案者が人材バンクに公開していなくても、大賛成した人は連絡できる）
-- =============================================================

-- ===========================
-- 1. 投票重みの再計算トリガーを UPDATE 全般で発火させる
--    旧: before insert or update OF VOTER_ID → 投票の変更時に発火せず、
--        アプリが渡す weight = 0 がそのまま保存されていた
-- ===========================
drop trigger if exists trg_calc_vote_weight on public.votes;
create trigger trg_calc_vote_weight
  before insert or update on public.votes
  for each row execute function public.calc_vote_weight();

-- ===========================
-- 2. 集計を INSERT / UPDATE の両方で同期する
--    旧: after insert のみ。選択肢の変更・撤回で集計が動かなかった
--    DELETE は張らない（proposals 削除時の cascade と競合して
--    消えたはずの集計行が復活しうるため）
-- ===========================
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

  -- 変更前の票を取り消す（集計に載っていたのは retracted_at is null の行だけ）
  if tg_op = 'UPDATE' and old.retracted_at is null then
    update public.vote_aggregates
       set count        = greatest(0, count - 1),
           weight_total = greatest(0, weight_total - old.weight),
           updated_at   = now()
     where proposal_id = old.proposal_id
       and tier        = v_tier
       and choice      = old.choice;
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

drop trigger if exists trg_update_vote_aggregate on public.votes;
drop trigger if exists trg_sync_vote_aggregate on public.votes;
create trigger trg_sync_vote_aggregate
  after insert or update on public.votes
  for each row execute function public.sync_vote_aggregate();

-- 旧関数は使わないので削除（トリガーを外した後）
drop function if exists public.update_vote_aggregate();

-- ===========================
-- 3. 既存データの手当て
--    weight = 0 で保存されてしまった票を現在の tier / residency で再計算し、
--    vote_aggregates を votes から作り直す。
--    ※ 撤回済みの票が集計から外れるため、表示中の数値が変わることがある
-- ===========================
update public.votes v
   set weight = case m.tier
                  when 'light'      then 0.1
                  when 'email_only' then case m.residency_type when 'citizen' then 0.3 else 0.15 end
                  when 'verified'   then case m.residency_type when 'citizen' then 1.0 else 0.5 end
                end
  from public.members m
 where m.id = v.voter_id;

delete from public.vote_aggregates;

insert into public.vote_aggregates (proposal_id, tier, choice, count, weight_total, updated_at)
select v.proposal_id, m.tier, v.choice, count(*), sum(v.weight), now()
  from public.votes v
  join public.members m on m.id = v.voter_id
 where v.retracted_at is null
 group by v.proposal_id, m.tier, v.choice;

-- ===========================
-- 4. 「大賛成」で名乗り出るかどうか
-- ===========================
alter table public.votes
  add column if not exists disclose_identity boolean not null default false;

comment on column public.votes.disclose_identity is
  '大賛成のとき、提案者に自分の名前を伝えて連絡を取れるようにするか。既定は false（投票の秘密）。';

-- 本人が自分の票を読めるようにする（UI が「選択中」を出すために必要。
-- 他人の票は従来どおり読めない）
drop policy if exists votes_select_own on public.votes;
create policy votes_select_own on public.votes
  for select to authenticated
  using (voter_id = auth.uid());

-- 提案者は、自分の提案に「大賛成 かつ 名乗る」で投じられた票だけを読める
drop policy if exists votes_select_disclosed_supporter on public.votes;
create policy votes_select_disclosed_supporter on public.votes
  for select to authenticated
  using (
    disclose_identity = true
    and choice = '大賛成'
    and retracted_at is null
    and exists (
      select 1 from public.proposals p
       where p.id = votes.proposal_id
         and p.proposer_id = auth.uid()
    )
  );

-- ===========================
-- 5. 提案起点のメッセージ（既存の「活動の声がけ」を流用）
-- ===========================
alter table public.talent_inquiries
  add column if not exists proposal_id uuid references public.proposals(id) on delete set null;

comment on column public.talent_inquiries.proposal_id is
  '提案への大賛成を起点に送られたメッセージのとき、その提案 ID。人材バンク経由は null。';

create index if not exists idx_talent_inquiries_proposal
  on public.talent_inquiries(proposal_id) where proposal_id is not null;

-- 自分がその提案に「大賛成」を投じているか（votes は本人以外読めないため
-- RLS ポリシーから参照できるよう security definer で包む）
create or replace function public.i_strongly_support(p_proposal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.votes
     where proposal_id = p_proposal_id
       and voter_id    = auth.uid()
       and choice      = '大賛成'
       and retracted_at is null
  );
$$;

grant execute on function public.i_strongly_support(uuid) to authenticated;

-- 人材バンク経由の新規声がけは proposal_id を持たない、と明示する
drop policy if exists talent_inquiries_insert_sender on public.talent_inquiries;
create policy talent_inquiries_insert_sender
  on public.talent_inquiries for insert
  to authenticated
  with check (
    reply_to_inquiry_id is null
    and proposal_id is null
    and from_member_id = auth.uid()
    and from_member_id <> to_member_id
    and exists (
      select 1 from public.members m
      where m.id = auth.uid()
        and m.tier <> 'light'
        and m.deleted_at is null
    )
    and exists (
      select 1 from public.member_profiles_pr p
      where p.member_id = to_member_id
        and p.message_acceptance <> 'closed'
    )
  );

-- 提案に大賛成した人 → その提案の提案者。人材バンクの公開状態は問わない
drop policy if exists talent_inquiries_insert_proposal_supporter on public.talent_inquiries;
create policy talent_inquiries_insert_proposal_supporter
  on public.talent_inquiries for insert
  to authenticated
  with check (
    reply_to_inquiry_id is null
    and proposal_id is not null
    and from_member_id = auth.uid()
    and from_member_id <> to_member_id
    and exists (
      select 1 from public.members m
      where m.id = auth.uid()
        and m.tier <> 'light'
        and m.deleted_at is null
    )
    and exists (
      select 1 from public.proposals p
      where p.id = talent_inquiries.proposal_id
        and p.proposer_id = talent_inquiries.to_member_id
    )
    and public.i_strongly_support(talent_inquiries.proposal_id)
  );

-- 提案者 → 名乗り出た支援者。支援者からの1通目を待たずに声をかけられる
-- （votes の参照は votes_select_disclosed_supporter ポリシーで通る）
drop policy if exists talent_inquiries_insert_proposer_outreach on public.talent_inquiries;
create policy talent_inquiries_insert_proposer_outreach
  on public.talent_inquiries for insert
  to authenticated
  with check (
    reply_to_inquiry_id is null
    and proposal_id is not null
    and from_member_id = auth.uid()
    and from_member_id <> to_member_id
    and exists (
      select 1 from public.proposals p
      where p.id = talent_inquiries.proposal_id
        and p.proposer_id = auth.uid()
    )
    and exists (
      select 1 from public.votes v
      where v.proposal_id       = talent_inquiries.proposal_id
        and v.voter_id          = talent_inquiries.to_member_id
        and v.choice            = '大賛成'
        and v.disclose_identity = true
        and v.retracted_at is null
    )
  );
