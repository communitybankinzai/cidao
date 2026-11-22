-- 会議メモ（CBI 運営会議の議題ページから、その場で入力するためのもの）
-- 2026-11-23 事業主決定：保存先は CiDAO のデータベース・議題ごとに「種類を選んで一言」を積み上げる形。
--
-- 守り方：
--   ・表は RLS を有効にし、方針（policy）を1つも置かない＝外から直接は読めない・書けない。
--   ・読み書きは下の関数だけ。関数は「会議ID＋合言葉」が合ったときだけ動く。
--   ・合言葉そのものは保存しない（sha256 の値だけを meeting_keys に置く）。
--   ・消すときは行を残して deleted_at を入れる（あとで経緯をたどれるように）。

create table if not exists public.meeting_keys (
  meeting_id text primary key,
  key_hash   text not null,
  title      text,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_notes (
  id         bigint generated always as identity primary key,
  meeting_id text not null references public.meeting_keys(meeting_id) on delete cascade,
  agenda     text not null check (agenda ~ '^[a-z0-9_-]{1,20}$'),
  kind       text not null check (kind in ('decision','todo','carry','memo')),
  body       text not null check (char_length(body) between 1 and 600),
  author     text check (author is null or char_length(author) <= 30),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists meeting_notes_meeting_idx
  on public.meeting_notes (meeting_id, id);

alter table public.meeting_keys  enable row level security;
alter table public.meeting_notes enable row level security;

revoke all on public.meeting_keys  from anon, authenticated;
revoke all on public.meeting_notes from anon, authenticated;

-- 合言葉の照合（合わなければ例外）
create or replace function public.meeting_check_key(p_meeting text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_meeting is null or p_key is null or not exists (
    select 1 from public.meeting_keys k
    where k.meeting_id = p_meeting
      and k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'meeting key mismatch' using errcode = '28000';
  end if;
end;
$$;

-- 一覧（その会議の全件を番号順に返す。消したものも deleted=true で返し、画面から外せるようにする）
create or replace function public.meeting_notes_list(p_meeting text, p_key text)
returns table (
  id bigint, agenda text, kind text, body text, author text,
  created_at timestamptz, deleted boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.meeting_check_key(p_meeting, p_key);
  return query
    select n.id, n.agenda, n.kind,
           case when n.deleted_at is null then n.body else '' end,
           n.author, n.created_at, (n.deleted_at is not null)
    from public.meeting_notes n
    where n.meeting_id = p_meeting
    order by n.id;
end;
$$;

-- 追加
create or replace function public.meeting_notes_add(
  p_meeting text, p_key text, p_agenda text, p_kind text, p_body text, p_author text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  perform public.meeting_check_key(p_meeting, p_key);
  insert into public.meeting_notes (meeting_id, agenda, kind, body, author)
  values (p_meeting, p_agenda, p_kind, btrim(p_body), nullif(btrim(coalesce(p_author, '')), ''))
  returning meeting_notes.id into v_id;
  return v_id;
end;
$$;

-- 取り消し（行は残す）
create or replace function public.meeting_notes_delete(p_meeting text, p_key text, p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.meeting_check_key(p_meeting, p_key);
  update public.meeting_notes
     set deleted_at = now()
   where id = p_id and meeting_id = p_meeting and deleted_at is null;
end;
$$;

revoke all on function public.meeting_check_key(text, text) from public, anon, authenticated;
revoke all on function public.meeting_notes_list(text, text) from public;
revoke all on function public.meeting_notes_add(text, text, text, text, text, text) from public;
revoke all on function public.meeting_notes_delete(text, text, bigint) from public;

grant execute on function public.meeting_notes_list(text, text) to anon, authenticated;
grant execute on function public.meeting_notes_add(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.meeting_notes_delete(text, text, bigint) to anon, authenticated;

notify pgrst, 'reload schema';
