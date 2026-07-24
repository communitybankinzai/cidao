-- =============================================================
-- comment_likes — コメントいいねの重複防止（1人1コメント1回）
-- 従来は comments.likes を無制限にインクリメントできた（連打可能）。
-- 誰がいいねしたかを記録し、likeComment はトグル式に変更。
-- comments.likes は表示用カウントとして維持し、adjust_comment_likes
-- （SECURITY DEFINER）経由でのみ増減する。
-- =============================================================

create table public.comment_likes (
  comment_id  uuid not null references public.comments(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, member_id)
);

alter table public.comment_likes enable row level security;

-- SELECT: 本人の行のみ（「自分がいいね済みか」の判定用。件数表示は comments.likes を使う）
create policy comment_likes_select_own
  on public.comment_likes for select
  to authenticated
  using (member_id = auth.uid());

-- INSERT/DELETE: 本人のみ
create policy comment_likes_insert_own
  on public.comment_likes for insert
  to authenticated
  with check (member_id = auth.uid());

create policy comment_likes_delete_own
  on public.comment_likes for delete
  to authenticated
  using (member_id = auth.uid());

grant select, insert, delete on public.comment_likes to authenticated;

-- いいね数の増減（comments のUPDATEポリシーを迂回するため SECURITY DEFINER）
create or replace function public.adjust_comment_likes(p_comment_id uuid, p_delta integer)
returns void
language sql security definer set search_path = public
as $$
  update public.comments
  set likes = greatest(coalesce(likes, 0) + p_delta, 0)
  where id = p_comment_id;
$$;

grant execute on function public.adjust_comment_likes(uuid, integer) to authenticated;

-- 既存の likes は連打による重複を含み実態と照合できないため 0 にリセット
-- （comment_likes 導入後の実いいねで再カウントする）
update public.comments set likes = 0 where coalesce(likes, 0) > 0;
