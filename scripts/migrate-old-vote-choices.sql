-- =============================================================
-- 【任意実行】選択肢統一(2026-07-29)より前の諮問的提案の票を読み替える
--
-- 新4択: 大賛成（是非協力したい）／賛成（でも協力は難しい）
--        ／保留（もっと知りたい）／反対（良いと思わない）
--
-- 拘束的提案の旧票（賛成／反対／保留）は文字列が一致するため、
-- 何もしなくてもそのまま新選択肢として扱われる。読み替えが要るのは
-- 諮問的提案の票（協力できる／難しい／わからない）だけ。
--
-- 実行しない場合: それらは賛否判定にも保留にも数えられず、
--   定足数の分母にだけ残る（合算バーには「統一前の票」として表示される）
--
-- 読み替え（意味の欠落があるため、実行可否は運用判断）:
--   協力できる → 大賛成
--   難しい     → 賛成
--   わからない → 保留
--
-- 注意:
--   ・vote_aggregates は PK(proposal_id, tier, choice) のため単純 UPDATE では
--     衝突する。votes を書き換えたうえで集計を作り直す。
--   ・tier は「投票時点」ではなく「現在」の members.tier で再集計される。
--   ・20260729150000 / 20260729160000 を先に適用しておくこと。
--   ・取り消せない。実行前に「1_変更前」の結果を控えておくこと。
--
-- Supabase SQL Editor に全文を貼って Run。末尾に結果が表示される。
-- =============================================================

-- 変更前の対象を記録（結果表の「1_変更前」）
create temporary table _before_choices as
select choice, count(*) as cnt
  from public.votes
 where choice in ('協力できる', '難しい', 'わからない')
   and retracted_at is null
 group by choice;

-- 読み替え
update public.votes
   set choice = case choice
                  when '協力できる' then '大賛成'
                  when '難しい'     then '賛成'
                  when 'わからない' then '保留'
                  else choice
                end
 where choice in ('協力できる', '難しい', 'わからない');

-- 集計を votes から作り直す
delete from public.vote_aggregates;

insert into public.vote_aggregates (proposal_id, tier, choice, count, weight_total, updated_at)
select v.proposal_id,
       m.tier,
       v.choice,
       count(*),
       sum(v.weight),
       now()
  from public.votes v
  join public.members m on m.id = v.voter_id
 where v.retracted_at is null
 group by v.proposal_id, m.tier, v.choice;

-- PostgREST にスキーマ再読込（念のため）
notify pgrst, 'reload schema';

-- 結果
select '1_変更前' as 区分, choice as 選択肢, cnt::text as 件数, '' as 重み
  from _before_choices
union all
select '2_変更後の全集計', choice, sum(count)::text, sum(weight_total)::text
  from public.vote_aggregates
 group by choice
order by 1, 2;
