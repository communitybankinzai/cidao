-- Phase 2: AIインタビューのみ。Phase 1 適用後に実行する。
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.talent_subjects(id),
  member_id uuid not null references public.members(id),
  kind text not null default 'talent' check (kind in ('talent', 'request')),
  status text not null default 'active' check (status in ('active', 'paused', 'done', 'abandoned')),
  collected_json jsonb not null default '{}'::jsonb,
  sufficiency_json jsonb,
  turn_count int not null default 0,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists interviews_one_active_kind
  on public.interviews (member_id, kind) where status = 'active';
create index if not exists interviews_member_activity on public.interviews (member_id, last_activity_at desc);
comment on table public.interviews is '本人・代表者のAIインタビュー。Phase 2 は talent のみ。本人と運営が閲覧。';
comment on column public.interviews.collected_json is 'field_keyごとにstate(answered/none/declined/unknown), value, evidence(発話UUID配列), updated_atを保持。推測や連絡先は禁止。';
comment on column public.interviews.sufficiency_json is 'AIとサーバーの充足判定。処理中はin_flight UUIDとlease_untilを保持し同時ターンを防ぐ。';
comment on column public.interviews.turn_count is 'AI呼び出し枠の消費数。失敗も含む。上限40の判定はアプリのconfig.tsで行う（DB checkなし）。';

create table if not exists public.interview_messages (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id),
  seq int not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  run_id uuid,
  created_at timestamptz not null default now(),
  unique (interview_id, seq)
);
create index if not exists interview_messages_retention on public.interview_messages (created_at);
comment on table public.interview_messages is '会話原文。本人と運営のみ閲覧。365日を超えた原文はcronで削除。本文をログへ転記しない。';
comment on column public.interview_messages.seq is '挨拶0、ターンnのuser=2n-1/assistant=2n。AI失敗や原文の期限削除で欠番になる。';
comment on column public.interview_messages.run_id is 'assistantに対応するapi_usage.run_id。固定挨拶はNULL。費用記録のbest-effort性のため外部キーを張らない。';

alter table public.interviews enable row level security;
alter table public.interview_messages enable row level security;
-- 既存の広い default privileges をこの2テーブルについて取り消す。
revoke all on public.interviews, public.interview_messages from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant all on public.interviews, public.interview_messages to service_role;
grant select, insert, update on public.interviews to authenticated;
grant select, insert on public.interview_messages to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='interviews' and policyname='interviews_select') then
    create policy interviews_select on public.interviews for select to authenticated using (member_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='interviews' and policyname='interviews_insert') then
    create policy interviews_insert on public.interviews for insert to authenticated with check (
      member_id = auth.uid() and exists (select 1 from public.talent_subjects s where s.id = subject_id and s.owner_member_id = auth.uid())
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='interviews' and policyname='interviews_update') then
    create policy interviews_update on public.interviews for update to authenticated using (member_id = auth.uid()) with check (
      member_id = auth.uid() and exists (select 1 from public.talent_subjects s where s.id = subject_id and s.owner_member_id = auth.uid())
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='interview_messages' and policyname='interview_messages_select') then
    create policy interview_messages_select on public.interview_messages for select to authenticated using (
      public.is_admin() or exists (select 1 from public.interviews i where i.id = interview_id and i.member_id = auth.uid())
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='interview_messages' and policyname='interview_messages_insert') then
    create policy interview_messages_insert on public.interview_messages for insert to authenticated with check (
      exists (select 1 from public.interviews i where i.id = interview_id and i.member_id = auth.uid())
    );
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.interviews'::regclass and tgname='talent_bank_touch_interview') then
    create trigger talent_bank_touch_interview before update on public.interviews for each row execute function public.talent_bank_touch_subject();
  end if;
end;
$$;

-- HTTP越しの複数writeを原子的にする。security invokerのため本人のRLSを維持。
-- APIの実行をDBトランザクション内で待たない。異常終了時のleaseは5分で失効。
create or replace function public.claim_interview_turn(
  p_id uuid, p_expected_count int, p_token uuid, p_message_id uuid, p_content text
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_interview public.interviews%rowtype;
begin
  select * into v_interview from public.interviews
    where id = p_id and member_id = auth.uid() and kind = 'talent' for update;
  if not found or v_interview.status <> 'active' or v_interview.turn_count <> p_expected_count then return false; end if;
  if v_interview.sufficiency_json->>'in_flight' is not null
    and (v_interview.sufficiency_json->>'lease_until')::timestamptz > now() then return false; end if;
  insert into public.interview_messages (id, interview_id, seq, role, content)
    values (p_message_id, p_id, (p_expected_count + 1) * 2 - 1, 'user', p_content);
  update public.interviews set turn_count = p_expected_count + 1, last_activity_at = now(),
    sufficiency_json = jsonb_build_object('in_flight', p_token, 'lease_until', now() + interval '5 minutes')
    where id = p_id;
  return true;
end;
$$;

create or replace function public.finish_interview_turn(
  p_id uuid, p_token uuid, p_content text, p_run_id uuid,
  p_collected jsonb, p_sufficiency jsonb, p_done boolean
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_interview public.interviews%rowtype;
begin
  select * into v_interview from public.interviews
    where id = p_id and member_id = auth.uid() and kind = 'talent' for update;
  if not found or v_interview.status <> 'active'
    or (v_interview.sufficiency_json->>'in_flight') is distinct from p_token::text then return false; end if;
  insert into public.interview_messages (interview_id, seq, role, content, run_id)
    values (p_id, v_interview.turn_count * 2, 'assistant', p_content, p_run_id);
  update public.interviews set collected_json = p_collected, sufficiency_json = p_sufficiency,
    status = case when p_done then 'done' else 'active' end,
    completed_at = case when p_done then now() else null end, last_activity_at = now()
    where id = p_id;
  return true;
end;
$$;
revoke all on function public.claim_interview_turn(uuid,int,uuid,uuid,text), public.finish_interview_turn(uuid,uuid,text,uuid,jsonb,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.claim_interview_turn(uuid,int,uuid,uuid,text), public.finish_interview_turn(uuid,uuid,text,uuid,jsonb,jsonb,boolean) to authenticated, service_role;
comment on function public.claim_interview_turn(uuid,int,uuid,uuid,text) is '本人のターン枠確保とuser原文保存を同一トランザクションで行う。上限は呼び出し前にアプリで判定。';
comment on function public.finish_interview_turn(uuid,uuid,text,uuid,jsonb,jsonb,boolean) is '本人の処理tokenを照合しassistant発話・抽出値・完了状態を同時保存。外部AIは呼ばない。';

create extension if not exists pg_cron;
do $$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname = 'cidao_purge_interview_messages'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end $$;
-- 既存ジョブと同じUTC基準: 毎日03:15（JST 12:15）。原文のみを削除。
select cron.schedule(
  'cidao_purge_interview_messages', '15 3 * * *',
  $$delete from public.interview_messages where created_at < now() - interval '365 days';$$
);
