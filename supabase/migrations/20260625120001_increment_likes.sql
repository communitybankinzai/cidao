-- 議論機能 F14: コメントいいね（質問の優先順位投票用、§3.3.6 派生機能）
-- 重複防止は別テーブルで実装可能だが Phase 1 では未対応（運用上の自浄に依存）

create or replace function public.increment_comment_likes(p_comment_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_new_likes integer;
begin
  update public.comments
     set likes = coalesce(likes, 0) + 1
   where id = p_comment_id
  returning likes into v_new_likes;
  return v_new_likes;
end;
$$;
