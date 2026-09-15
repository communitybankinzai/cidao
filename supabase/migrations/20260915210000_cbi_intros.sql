-- 他己紹介（CBI が書き、本人が確認してから紹介ページに載せる）。2026-09-15 中司さん決定：
-- 下書きはまず運営が手で書き、AI の下書きは後で足す（案C）／紹介ページで見られるのはログインした会員だけ（案A）。

-- 1. 同意の種類に cbi_intro（CBI が他己紹介を書いて載せてよい）を足す
alter table public.consents drop constraint if exists consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('interview','profile','photo','video','sns','bank','matching','external_ai','cbi_intro'));

-- 2. 作業時間の種類に intro_write（他己紹介を書く）を足す。AI の下書きを足すかどうかの判断材料にする
alter table public.work_logs drop constraint if exists work_logs_kind_check;
alter table public.work_logs add constraint work_logs_kind_check
  check (kind in ('profile_review','text_edit','video_review','video_edit','inquiry_support','ops','illustration','intro_write'));

-- 3. 他己紹介の本体（1人1件）。書き込みはサーバー（service_role）だけ。本人・運営かどうかの確認はサーバー側で行う
create table if not exists public.member_cbi_intros (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members(id),
  body text not null default '' check (char_length(body) <= 400),
  status text not null default 'draft' check (status in ('draft','owner_review','published','returned')),
  draft_source text not null default 'manual' check (draft_source in ('manual','ai')),
  written_by uuid references public.members(id),
  requested_at timestamptz,
  owner_approved_at timestamptz,
  owner_comment text check (char_length(owner_comment) <= 1000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_member_cbi_intros_updated_at on public.member_cbi_intros;
create trigger set_member_cbi_intros_updated_at before update on public.member_cbi_intros
  for each row execute function public.set_updated_at();

-- 本人の同意が有効か。他人の同意の記録は RLS で読めないので、有効かどうかだけを security definer で返す
create or replace function public.cbi_intro_consented(p_member uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.consents
    where member_id = p_member and kind = 'cbi_intro' and subject_id is null and revoked_at is null)
$$;
revoke all on function public.cbi_intro_consented(uuid) from public, anon;
grant execute on function public.cbi_intro_consented(uuid) to authenticated, service_role;

alter table public.member_cbi_intros enable row level security;
revoke all on public.member_cbi_intros from anon, authenticated;
grant select on public.member_cbi_intros to authenticated;
grant all on public.member_cbi_intros to service_role;

drop policy if exists cbi_intros_select_admin on public.member_cbi_intros;
create policy cbi_intros_select_admin on public.member_cbi_intros for select to authenticated using (public.is_admin());
-- 本人は、運営が確認を依頼した後のものだけ見える（書きかけの下書きは見えない）
drop policy if exists cbi_intros_select_own on public.member_cbi_intros;
create policy cbi_intros_select_own on public.member_cbi_intros for select to authenticated
  using (member_id = auth.uid() and status <> 'draft');
-- 紹介ページ：ログインした会員に、掲載中かつ本人の同意が有効なものだけ（未ログインの anon には権限を与えない）
drop policy if exists cbi_intros_select_published on public.member_cbi_intros;
create policy cbi_intros_select_published on public.member_cbi_intros for select to authenticated
  using (status = 'published' and public.cbi_intro_consented(member_id));
