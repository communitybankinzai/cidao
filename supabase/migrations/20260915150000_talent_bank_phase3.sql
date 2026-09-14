-- Phase 3 only. File creation only; apply after review in the deployment environment.
create table if not exists public.talent_profiles (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null unique references public.talent_subjects(id),
  member_id uuid not null references public.members(id),
  current_version_id uuid, draft_version_id uuid,
  public_scope text not null default 'private' check (public_scope in ('public','registered_only','private')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.talent_profile_versions (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.talent_profiles(id),
  version int not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','owner_reviewed','approved','published','retired')),
  fields_json jsonb not null,
  summary_short text check (char_length(summary_short) <= 80),
  summary_long text check (char_length(summary_long) <= 400), generated_run_id uuid,
  edited_by_owner_at timestamptz, owner_approved_at timestamptz,
  admin_approved_by uuid references public.members(id), admin_approved_at timestamptz, rejected_reason text,
  public_scope text not null default 'private' check (public_scope in ('public','registered_only','private')),
  suggested_tags text[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(profile_id, version), unique(profile_id, id)
);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='talent_profile_current_fk' and conrelid='public.talent_profiles'::regclass) then
    alter table public.talent_profiles add constraint talent_profile_current_fk foreign key (id,current_version_id) references public.talent_profile_versions(profile_id,id);
    alter table public.talent_profiles add constraint talent_profile_draft_fk foreign key (id,draft_version_id) references public.talent_profile_versions(profile_id,id);
  end if;
end $$;
create table if not exists public.talent_tags (
  id uuid primary key default gen_random_uuid(), slug text not null unique, label text not null,
  kind text not null check (kind in ('skill','field','target','area','style')), created_at timestamptz not null default now()
);
create table if not exists public.tag_synonyms (
  id uuid primary key default gen_random_uuid(), tag_id uuid not null references public.talent_tags(id),
  synonym text not null, unique(tag_id,synonym)
);
create table if not exists public.talent_profile_version_tags (
  version_id uuid not null references public.talent_profile_versions(id), tag_id uuid not null references public.talent_tags(id),
  source text not null check (source in ('ai','owner')), primary key(version_id,tag_id)
);
create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.talent_profiles(id),
  version_id uuid not null, scope text not null check (scope in ('public','registered_only','private')),
  owner_approved_at timestamptz not null, admin_approved_by uuid not null references public.members(id),
  admin_approved_at timestamptz not null, published_at timestamptz not null, unpublished_at timestamptz,
  reason text, created_at timestamptz not null default now(),
  foreign key(profile_id,version_id) references public.talent_profile_versions(profile_id,id)
);
create unique index if not exists talent_one_published on public.talent_profile_versions(profile_id) where status='published';
create unique index if not exists talent_one_publication on public.publications(profile_id) where unpublished_at is null;
create index if not exists talent_profiles_member on public.talent_profiles(member_id);
create index if not exists talent_versions_review on public.talent_profile_versions(status);
-- pg_trgm is already installed; resolve its opclass schema without assuming public/extensions.
do $$ declare s text; begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
  if s is null then raise exception 'pg_trgm required'; end if;
  execute format('create index if not exists talent_summary_trgm on public.talent_profile_versions using gin(summary_long %I.gin_trgm_ops)',s);
  execute format('create index if not exists talent_tag_label_trgm on public.talent_tags using gin(label %I.gin_trgm_ops)',s);
end $$;
comment on table public.talent_profiles is '公開版と編集中の版を分離。public_scopeは現在の公開版の範囲。';
comment on table public.talent_profile_versions is '本人確認・運営確認が必要なプロフィール版。住所・電話・メールの専用項目を持たない。';
comment on column public.talent_profile_versions.fields_json is '20項目限定。state/value/evidence/source。evidenceは発話UUIDのみ、会話原文なし。';
comment on column public.talent_profile_versions.public_scope is 'この版で本人が申請する公開範囲。編集中は公開版の範囲を変更しない。';
comment on column public.talent_profile_versions.suggested_tags is 'AIによる未登録タグの提案。タグ辞書には自動追加しない。';
comment on table public.talent_tags is '運営管理の既存タグ辞書。';
comment on table public.tag_synonyms is '検索の表記揺れを吸収する同義語。';
comment on table public.talent_profile_version_tags is '版ごとのタグと追加主体。';
comment on table public.publications is '本人承認・運営承認・公開範囲と公開停止の履歴。本人と運営のみ閲覧。';

-- Revoke broad pre-existing default privileges on these objects only.
revoke all on public.talent_profiles, public.talent_profile_versions, public.talent_tags, public.tag_synonyms, public.talent_profile_version_tags, public.publications from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant all on public.talent_profiles, public.talent_profile_versions, public.talent_tags, public.tag_synonyms, public.talent_profile_version_tags, public.publications to service_role;
grant select on public.talent_profiles, public.talent_profile_versions, public.talent_tags, public.tag_synonyms, public.talent_profile_version_tags to anon, authenticated;
grant select on public.publications to authenticated;
grant insert, update on public.talent_profiles, public.talent_profile_versions to authenticated;
grant insert, delete on public.talent_profile_version_tags to authenticated;
alter table public.talent_profiles enable row level security;
alter table public.talent_profile_versions enable row level security;
alter table public.talent_tags enable row level security;
alter table public.tag_synonyms enable row level security;
alter table public.talent_profile_version_tags enable row level security;
alter table public.publications enable row level security;

-- Recreate named policies to keep this migration repeatable.
drop policy if exists talent_profile_read on public.talent_profiles;
create policy talent_profile_read on public.talent_profiles for select using (
  member_id=auth.uid() or public.is_admin() or (current_version_id is not null and
  (public_scope='public' or (public_scope='registered_only' and auth.uid() is not null)))
);
drop policy if exists talent_profile_insert on public.talent_profiles;
create policy talent_profile_insert on public.talent_profiles for insert to authenticated with check (
  member_id=auth.uid() and exists(select 1 from public.talent_subjects s where s.id=subject_id and s.owner_member_id=auth.uid())
);
drop policy if exists talent_profile_update on public.talent_profiles;
create policy talent_profile_update on public.talent_profiles for update to authenticated using(member_id=auth.uid()) with check(member_id=auth.uid());
drop policy if exists talent_version_read on public.talent_profile_versions;
create policy talent_version_read on public.talent_profile_versions for select using (
  public.is_admin() or exists(select 1 from public.talent_profiles p where p.id=profile_id and
    (p.member_id=auth.uid() or (status='published' and p.current_version_id=talent_profile_versions.id)))
);
drop policy if exists talent_version_insert on public.talent_profile_versions;
create policy talent_version_insert on public.talent_profile_versions for insert to authenticated with check (
  status='draft' and exists(select 1 from public.talent_profiles p where p.id=profile_id and p.member_id=auth.uid())
);
drop policy if exists talent_version_update on public.talent_profile_versions;
create policy talent_version_update on public.talent_profile_versions for update to authenticated using (
  status in ('draft','owner_reviewed') and exists(select 1 from public.talent_profiles p where p.id=profile_id and p.member_id=auth.uid())
) with check(status in ('draft','owner_reviewed') and exists(select 1 from public.talent_profiles p where p.id=profile_id and p.member_id=auth.uid()));
drop policy if exists talent_tag_read on public.talent_tags;
create policy talent_tag_read on public.talent_tags for select using(true);
drop policy if exists talent_synonym_read on public.tag_synonyms;
create policy talent_synonym_read on public.tag_synonyms for select using(true);
drop policy if exists talent_version_tag_read on public.talent_profile_version_tags;
create policy talent_version_tag_read on public.talent_profile_version_tags for select using(exists(select 1 from public.talent_profile_versions v where v.id=version_id));
drop policy if exists talent_version_tag_insert on public.talent_profile_version_tags;
create policy talent_version_tag_insert on public.talent_profile_version_tags for insert to authenticated with check (
  exists(select 1 from public.talent_profile_versions v join public.talent_profiles p on p.id=v.profile_id where v.id=version_id and p.member_id=auth.uid() and v.status in ('draft','owner_reviewed'))
);
drop policy if exists talent_version_tag_delete on public.talent_profile_version_tags;
create policy talent_version_tag_delete on public.talent_profile_version_tags for delete to authenticated using (
  exists(select 1 from public.talent_profile_versions v join public.talent_profiles p on p.id=v.profile_id where v.id=version_id and p.member_id=auth.uid() and v.status in ('draft','owner_reviewed'))
);
drop policy if exists talent_publication_read on public.publications;
create policy talent_publication_read on public.publications for select to authenticated using (
  public.is_admin() or exists(select 1 from public.talent_profiles p where p.id=profile_id and p.member_id=auth.uid())
);

-- Validate even direct REST writes. Never accept extra public JSON keys or raw evidence text.
create or replace function public.valid_talent_fields(f jsonb, require_complete boolean default false)
returns boolean language plpgsql immutable set search_path=public as $$
declare k text; v jsonb; e jsonb;
  keys text[] := array['display_name','activities','can_do','accepts_requests','paid_or_free','areas','available_times','passion','business_name','strengths','experience','qualifications','can_help','target_people','current_troubles','looking_for','want_to_do_together','future_plans','want_to_connect','reason_started'];
begin
  if jsonb_typeof(f) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(f)) <> 20 then return false; end if;
  foreach k in array keys loop
    v := f->k;
    if v is null or jsonb_typeof(v) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(v)) <> 4 or not(v ?& array['state','value','evidence','source']) then return false; end if;
    if coalesce(v->>'state','') not in ('answered','none','declined','unknown') or coalesce(v->>'source','') not in ('interview','owner') then return false; end if;
    if v->>'state'='answered' then
      if jsonb_typeof(v->'value') is distinct from 'string' or length(trim(v->>'value'))=0 or length(v->>'value')>2000 then return false; end if;
    elsif v->'value' is distinct from 'null'::jsonb then return false;
    end if;
    if jsonb_typeof(v->'evidence') is distinct from 'array' then return false; end if;
    for e in select value from jsonb_array_elements(v->'evidence') loop
      if jsonb_typeof(e) <> 'string' or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    end loop;
    if require_complete and k=any(keys[1:8]) and v->>'state'='unknown' then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.guard_talent_profile()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_user not in ('postgres','service_role') then
    if TG_OP='INSERT' then
      if new.current_version_id is not null or new.draft_version_id is not null then raise exception 'Protected pointers'; end if;
    else
      if (new.id,new.subject_id,new.member_id,new.current_version_id,new.created_at) is distinct from (old.id,old.subject_id,old.member_id,old.current_version_id,old.created_at)
        or (old.current_version_id is not null and new.public_scope<>old.public_scope) then raise exception 'Protected profile'; end if;
    end if;
  end if;
  new.updated_at:=clock_timestamp(); return new;
end $$;
create or replace function public.guard_talent_version()
returns trigger language plpgsql set search_path=public as $$
begin
  if not public.valid_talent_fields(new.fields_json, new.status in ('owner_reviewed','approved','published')) then raise exception 'Invalid profile fields'; end if;
  if current_user not in ('postgres','service_role') then
    if TG_OP='INSERT' then
      if new.status<>'draft' or new.owner_approved_at is not null or new.admin_approved_at is not null or new.admin_approved_by is not null then raise exception 'Protected approval'; end if;
    else
      if old.status not in ('draft','owner_reviewed') or new.status not in ('draft','owner_reviewed') or
        (new.id,new.profile_id,new.version,new.generated_run_id,new.admin_approved_by,new.admin_approved_at,new.created_at) is distinct from
        (old.id,old.profile_id,old.version,old.generated_run_id,old.admin_approved_by,old.admin_approved_at,old.created_at) then raise exception 'Immutable version'; end if;
      if (new.fields_json,new.summary_short,new.summary_long,new.public_scope) is distinct from (old.fields_json,old.summary_short,old.summary_long,old.public_scope) then
        new.status:='draft'; new.owner_approved_at:=null; new.edited_by_owner_at:=clock_timestamp();
      end if;
    end if;
    if new.status='owner_reviewed' then new.owner_approved_at:=clock_timestamp(); else new.owner_approved_at:=null; end if;
  end if;
  new.updated_at:=clock_timestamp(); return new;
end $$;
-- Lock the parent before tag writes; a race with admin publication must never edit a published version.
create or replace function public.guard_talent_version_tag()
returns trigger language plpgsql set search_path=public as $$
declare v public.talent_profile_versions%rowtype;
begin
  select * into v from public.talent_profile_versions where id=case when TG_OP='DELETE' then old.version_id else new.version_id end for update;
  if v.status not in ('draft','owner_reviewed') then raise exception 'Immutable version tags'; end if;
  if TG_OP='DELETE' or new.source='owner' or v.status='owner_reviewed' then
    update public.talent_profile_versions set status='draft',owner_approved_at=null,edited_by_owner_at=clock_timestamp() where id=v.id;
  end if;
  if TG_OP='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists guard_talent_profile on public.talent_profiles;
create trigger guard_talent_profile before insert or update on public.talent_profiles for each row execute function public.guard_talent_profile();
drop trigger if exists guard_talent_version on public.talent_profile_versions;
create trigger guard_talent_version before insert or update on public.talent_profile_versions for each row execute function public.guard_talent_version();
drop trigger if exists guard_talent_version_tag on public.talent_profile_version_tags;
create trigger guard_talent_version_tag before insert or delete on public.talent_profile_version_tags for each row execute function public.guard_talent_version_tag();

create or replace function public.save_talent_draft(p_subject uuid,p_fields jsonb,p_short text,p_long text,p_run uuid,p_tags uuid[],p_suggested text[],p_scope text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare p public.talent_profiles%rowtype; v_id uuid; n int;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  insert into public.talent_profiles(subject_id,member_id) values(p_subject,auth.uid()) on conflict(subject_id) do nothing;
  select * into p from public.talent_profiles where subject_id=p_subject and member_id=auth.uid() for update;
  if not found then raise exception 'Unauthorized'; end if;
  select coalesce(max(version),0)+1 into n from public.talent_profile_versions where profile_id=p.id;
  insert into public.talent_profile_versions(profile_id,version,fields_json,summary_short,summary_long,generated_run_id,public_scope,suggested_tags)
    values(p.id,n,p_fields,p_short,p_long,p_run,p_scope,p_suggested) returning id into v_id;
  insert into public.talent_profile_version_tags(version_id,tag_id,source) select v_id,unnest(p_tags),case when p_run is null then 'owner' else 'ai' end;
  update public.talent_profiles set draft_version_id=v_id where id=p.id;
  return v_id;
end $$;
create or replace function public.edit_talent_draft(p_version uuid,p_expected timestamptz,p_fields jsonb,p_short text,p_long text,p_tags uuid[],p_scope text,p_approve boolean default false)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v public.talent_profile_versions%rowtype; p public.talent_profiles%rowtype;
begin
  select p0.* into p from public.talent_profiles p0 join public.talent_profile_versions v0 on v0.profile_id=p0.id where v0.id=p_version and p0.member_id=auth.uid() for update of p0;
  if not found or p.draft_version_id is distinct from p_version then return false; end if;
  select * into v from public.talent_profile_versions where id=p_version for update;
  if v.status not in ('draft','owner_reviewed') or v.updated_at<>p_expected then return false; end if;
  if (v.fields_json,v.summary_short,v.summary_long,v.public_scope) is distinct from (p_fields,p_short,p_long,p_scope)
    or (select coalesce(array_agg(tag_id order by tag_id),'{}'::uuid[]) from public.talent_profile_version_tags where version_id=p_version)
       is distinct from (select coalesce(array_agg(t order by t),'{}'::uuid[]) from (select distinct unnest(p_tags) t) s) then
    update public.talent_profile_versions set fields_json=p_fields,summary_short=p_short,summary_long=p_long,public_scope=p_scope,
      status='draft',owner_approved_at=null,edited_by_owner_at=clock_timestamp(),rejected_reason=null where id=p_version;
    delete from public.talent_profile_version_tags where version_id=p_version and not(tag_id=any(p_tags));
    insert into public.talent_profile_version_tags(version_id,tag_id,source) select p_version,t,'owner' from unnest(p_tags) t on conflict do nothing;
  end if;
  if p_approve then
    update public.talent_profile_versions set status='owner_reviewed',owner_approved_at=clock_timestamp(),rejected_reason=null where id=p_version;
  end if;
  if p.current_version_id is null then update public.talent_profiles set public_scope=p_scope where id=p.id; end if;
  return true;
end $$;
create or replace function public.approve_talent_owner(p_version uuid,p_expected timestamptz)
returns boolean language plpgsql security invoker set search_path=public as $$
declare p public.talent_profiles%rowtype;
begin
  select p0.* into p from public.talent_profiles p0 join public.talent_profile_versions v on v.profile_id=p0.id where v.id=p_version and p0.member_id=auth.uid() for update of p0;
  if not found or p.draft_version_id is distinct from p_version then return false; end if;
  update public.talent_profile_versions set status='owner_reviewed',owner_approved_at=clock_timestamp(),rejected_reason=null
    where id=p_version and status in ('draft','owner_reviewed') and updated_at=p_expected;
  return found;
end $$;

-- Service-only transactions. Actor is additionally checked against members.admin_role.
create or replace function public.publish_talent_version(p_actor uuid,p_version uuid,p_minutes int,p_edits int,p_note text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare p public.talent_profiles%rowtype; v public.talent_profile_versions%rowtype; t timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.members where id=p_actor and admin_role is not null) then raise exception 'Admin required'; end if;
  if p_minutes is null or p_minutes<0 or p_edits is null or p_edits<0 then raise exception 'Invalid work time'; end if;
  select p0.* into p from public.talent_profiles p0 join public.talent_profile_versions v0 on v0.profile_id=p0.id where v0.id=p_version for update of p0;
  if not found or p.draft_version_id is distinct from p_version then raise exception 'Stale version'; end if;
  select * into v from public.talent_profile_versions where id=p_version for update;
  if v.status<>'owner_reviewed' or v.owner_approved_at is null then raise exception 'Owner approval required'; end if;
  update public.talent_profile_versions set status='retired' where id=p.current_version_id;
  update public.publications set unpublished_at=t,reason='superseded' where profile_id=p.id and unpublished_at is null;
  update public.talent_profile_versions set status='published',admin_approved_by=p_actor,admin_approved_at=t,rejected_reason=null where id=v.id;
  update public.talent_profiles set current_version_id=v.id,draft_version_id=null,public_scope=v.public_scope where id=p.id;
  insert into public.publications(profile_id,version_id,scope,owner_approved_at,admin_approved_by,admin_approved_at,published_at)
    values(p.id,v.id,v.public_scope,v.owner_approved_at,p_actor,t,t);
  insert into public.work_logs(actor_member_id,case_id,subject_id,kind,started_at,ended_at,minutes,edit_count,note)
    values(p_actor,p.id,p.subject_id,'profile_review',t-make_interval(mins=>p_minutes),t,p_minutes,p_edits,p_note);
  return p.member_id;
end $$;
create or replace function public.reject_talent_version(p_actor uuid,p_version uuid,p_reason text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare p public.talent_profiles%rowtype;
begin
  if not exists(select 1 from public.members where id=p_actor and admin_role is not null) then raise exception 'Admin required'; end if;
  if length(trim(coalesce(p_reason,'')))=0 then raise exception 'Reason required'; end if;
  select p0.* into p from public.talent_profiles p0 join public.talent_profile_versions v on v.profile_id=p0.id where v.id=p_version for update of p0;
  if not found or p.draft_version_id is distinct from p_version then raise exception 'Stale version'; end if;
  update public.talent_profile_versions set status='draft',owner_approved_at=null,rejected_reason=p_reason where id=p_version and status='owner_reviewed';
  if not found then raise exception 'Not awaiting review'; end if;
  return p.member_id;
end $$;
create or replace function public.unpublish_talent_profile(p_actor uuid,p_profile uuid,p_reason text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare p public.talent_profiles%rowtype;
begin
  select * into p from public.talent_profiles where id=p_profile for update;
  if not found or (p.member_id<>p_actor and not exists(select 1 from public.members where id=p_actor and admin_role is not null)) then raise exception 'Unauthorized'; end if;
  if length(trim(coalesce(p_reason,'')))=0 then raise exception 'Reason required'; end if;
  update public.talent_profile_versions set status='retired' where id=p.current_version_id;
  update public.talent_profiles set current_version_id=null where id=p.id;
  update public.publications set unpublished_at=clock_timestamp(),reason=p_reason where profile_id=p.id and unpublished_at is null;
  return p.member_id;
end $$;

-- All visibility comes from RLS; owner/admin may see their own private published version.
create or replace function public.search_talent_profiles(p_q text default '',p_tag text default '',p_area text default '')
returns table(profile_id uuid,subject_id uuid,member_id uuid,version_id uuid,display_name text,summary_short text,summary_long text,fields_json jsonb,tags jsonb)
language sql stable security invoker set search_path=public as $$
  select p.id,p.subject_id,p.member_id,v.id,coalesce(v.fields_json->'display_name'->>'value','表示名未設定'),v.summary_short,v.summary_long,v.fields_json,
    coalesce((select jsonb_agg(to_jsonb(t) order by t.label) from public.talent_profile_version_tags vt join public.talent_tags t on t.id=vt.tag_id where vt.version_id=v.id),'[]'::jsonb)
  from public.talent_profiles p join public.talent_profile_versions v on v.id=p.current_version_id
  where v.status='published'
    and (p_q='' or v.fields_json->'display_name'->>'value' ilike p_q escape '\' or v.summary_short ilike p_q escape '\' or v.summary_long ilike p_q escape '\'
      or exists(select 1 from public.talent_profile_version_tags vt join public.talent_tags t on t.id=vt.tag_id where vt.version_id=v.id and
        (t.label ilike p_q escape '\' or exists(select 1 from public.tag_synonyms s where s.tag_id=t.id and s.synonym ilike p_q escape '\'))))
    and (p_tag='' or exists(select 1 from public.talent_profile_version_tags vt join public.talent_tags t on t.id=vt.tag_id where vt.version_id=v.id and t.slug=p_tag))
    and (p_area='' or v.fields_json->'areas'->>'value' ilike p_area escape '\' or exists(select 1 from public.talent_profile_version_tags vt join public.talent_tags t on t.id=vt.tag_id where vt.version_id=v.id and t.kind='area' and t.label ilike p_area escape '\'))
  order by v.created_at desc, v.id;
$$;

-- Remove default EXECUTE from every new function; exact signatures avoid touching Phase 1/2.
do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
    'valid_talent_fields','guard_talent_profile','guard_talent_version','guard_talent_version_tag','save_talent_draft','edit_talent_draft','approve_talent_owner',
    'publish_talent_version','reject_talent_version','unpublish_talent_profile','search_talent_profiles']) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
    execute format('comment on function %s is %L',f,'Phase 3: validated profile workflow; no external API or conversation logging.');
  end loop;
end $$;
grant execute on function public.valid_talent_fields(jsonb,boolean), public.save_talent_draft(uuid,jsonb,text,text,uuid,uuid[],text[],text), public.edit_talent_draft(uuid,timestamptz,jsonb,text,text,uuid[],text,boolean), public.approve_talent_owner(uuid,timestamptz) to authenticated;
grant execute on function public.search_talent_profiles(text,text,text) to anon,authenticated;

insert into public.talent_tags(slug,label,kind) values
 ('leather-artisan','革職人','skill'),('leathercraft','レザークラフト','skill'),('instructor','講師','skill'),
 ('for-children','子ども向け','target'),('workshop','ワークショップ','style'),('craft','ものづくり','field'),('custom-made','オーダーメイド','style'),
 ('inzai','印西市','area'),('shiroi','白井市','area'),('narita','成田市','area'),('chiba-newtown','千葉ニュータウン','area'),('online','オンライン','area'),
 ('children','子ども','target'),('seniors','高齢者','target'),('groups','団体','target'),('businesses','事業者','target'),
 ('class','講座','style'),('visit','出張','style'),('commission','受託','style'),('collaboration','協働','style') on conflict do nothing;
insert into public.tag_synonyms(tag_id,synonym)
 select t.id,s.synonym from (values ('leathercraft','革細工'),('leathercraft','革工芸'),('leather-artisan','革職人'),('children','こども'),('workshop','体験教室'),('online','リモート')) s(slug,synonym)
 join public.talent_tags t on t.slug=s.slug on conflict do nothing;
