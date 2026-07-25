-- =============================================================
-- コメント・質問の字数下限をUI制約からポイント付与条件へ移動
-- （仕様§3.4.1 の趣旨を維持しつつ、短文でも投稿できるようにする）
--
-- - 投稿自体は1字からOK（Server Action側の下限チェックを撤廃）
-- - 貢献度ポイントは「コメント50字以上（1pt）」「質問30字以上（2pt）」
--   のときだけ付与。回答（3pt）は従来どおり字数条件なし
-- =============================================================

create or replace function public.award_on_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- 短文はポイント対象外（投稿は許可、加算だけスキップ）
  if new.kind = 'comment' and char_length(new.body) < 50 then
    return new;
  end if;
  if new.kind = 'question' and char_length(new.body) < 30 then
    return new;
  end if;

  perform public.award_contribution(
    new.author_id,
    case new.kind
      when 'question' then 'question_posted'
      when 'answer'   then 'question_answered'
      else 'comment_posted'
    end,
    case new.kind
      when 'question' then 2
      when 'answer'   then 3
      else 1
    end,
    new.proposal_id,
    null
  );
  return new;
end;
$$;
