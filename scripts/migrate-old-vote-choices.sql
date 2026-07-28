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
--   定足数の分母にだけ残る（一覧・層別バーの内訳には出ない）
--
-- 実行する場合の読み替え（意味の欠落があるため、実行可否は運用判断）:
--   協力できる → 大賛成
--   難しい     → 賛成
--   わからない → 保留
--
-- 注意:
--   1. vote_aggregates は PK(proposal_id, tier, choice) のため単純 UPDATE では
--      衝突する。votes を書き換えたうえで集計を作り直す。
--   2. tier は「投票時点」ではなく「現在」の members.tier で再集計される。
--   3. 20260729150000_vote_support_followup.sql を先に適用しておくこと
--      （集計の作り直しと weight の再計算がそちらに入っている）。
--
-- Supabase SQL Editor で実行すること。begin; 〜 select で結果を確認し、
-- 問題なければ commit;、戻したければ rollback; とすること。
-- =============================================================

begin;

-- 諮問的提案の意向を新しい選択肢に読み替える
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

-- 確認用
select proposal_id, tier, choice, count, weight_total
  from public.vote_aggregates
 order by proposal_id, tier, choice;

-- 問題なければ commit; 戻すなら rollback;
-- commit;
