-- 写真投稿者の claim（身元紐づけ）＋情報提供への貢献度ポイント
--
-- COCoLa 画像スキャン経由の取り込みイベントは bot 主催のため、実際に写真を
-- 投稿した市民が編集できず、貢献度ポイントも付かない。submitter_member_id で
-- 投稿者本人を紐づけ、(a) 本人による編集、(b) 情報提供ポイント付与を可能にする。

-- 1. submitter 列
alter table public.events
  add column if not exists submitter_member_id uuid references public.members(id) on delete set null;

create index if not exists idx_events_submitter on public.events(submitter_member_id)
  where submitter_member_id is not null;

-- 2. can_edit_event に「写真投稿者本人（claim 済み）」条件を追加（既存条件は維持）
create or replace function public.can_edit_event(event_row public.events)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select
    -- 個人主催本人
    (event_row.organizer_type = 'member' and event_row.organizer_id = auth.uid())
    -- 主催団体の officer/rep
    or (event_row.organizer_type = 'org' and public.is_org_officer(event_row.organizer_id))
    -- 写真投稿者本人（claim 済み）
    or (event_row.submitter_member_id is not null and event_row.submitter_member_id = auth.uid())
    -- proxy 登録 + name 一致団体の officer/rep
    or (
      event_row.proxy_registration = true
      and event_row.organizer_name_text is not null
      and exists (
        select 1 from public.organizations o
        where o.name = event_row.organizer_name_text
          and public.is_org_officer(o.id)
      )
    )
    -- 関連団体の contact_email が auth.jwt().email と一致
    or exists (
      select 1 from public.organizations o
      where (
        (event_row.organizer_type = 'org' and o.id = event_row.organizer_id)
        or (event_row.proxy_registration = true and event_row.organizer_name_text = o.name)
      )
      and o.contact_email is not null
      and lower(o.contact_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

-- 3. claim_event(): ログインユーザーが「未claim の取り込みイベント」を自分の投稿として申告。
--    submitter をセットし、情報提供ポイント(event_submitted, 10pt)を付与（重複防止）。
--    SECURITY DEFINER で RLS の鶏卵問題（未claim だと UPDATE できない）を回避し、
--    関数内で「未claim かつ外部取り込みイベント」のみ許可する。
create or replace function public.claim_event(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- 既に submitter がいる場合（横取り防止）
  if v_event.submitter_member_id is not null then
    if v_event.submitter_member_id = v_uid then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  -- claim 対象は外部取り込み（ingest）イベントに限定
  if v_event.external_source is null then
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;

  update public.events
    set submitter_member_id = v_uid, updated_at = now()
    where id = p_event_id;

  -- 情報提供ポイント付与（同一イベントへの二重付与を防止）
  if not exists (
    select 1 from public.contributions
    where actor_id = v_uid and action_type = 'event_submitted' and related_id = p_event_id
  ) then
    perform public.award_contribution(v_uid, 'event_submitted', 10, p_event_id, '写真でのイベント情報提供');
  end if;

  return jsonb_build_object('ok', true, 'awarded', 10);
end;
$$;

revoke all on function public.claim_event(uuid) from public;
grant execute on function public.claim_event(uuid) to authenticated;
