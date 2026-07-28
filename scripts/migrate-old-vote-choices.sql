-- =============================================================
-- 【任意実行】4択化(2026-07-29)より前の投票を新4択に読み替える
--
-- 実行しない場合: 旧票（協力できる/難しい/わからない/保留）はそのまま残り、
--   ・賛否判定には数えられない（定足数の分母にはカウントされる）
--   ・提案一覧・層別バーの内訳には出ない（合計票数には出る）
--
-- 実行する場合の読み替え（意味の欠落があるため、実行可否は運用判断）:
--   協力できる → 大賛成   （是非協力したい）
--   難しい     → 賛成     （でも協力は難しい）
--   わからない → 無理     （※「判断保留」の意味は失われる）
--   保留       → 無理     （※「判断保留」の意味は失われる）
--
-- 注意:
--   1. vote_aggregates は PK(proposal_id, tier, choice) のため単純 UPDATE では
--      衝突する。votes を書き換えたうえで集計を作り直す。
--   2. 作り直しにより「撤回された票」が集計から外れる（現行トリガーは
--      insert 時しか集計を増やさず、撤回・変更を減算していないため）。
--      = 今表示されている数値が変わる可能性がある。
--   3. tier は「投票時点」ではなく「現在」の members.tier で再集計される。
--
-- Supabase SQL Editor で実行すること。まず begin; 〜 select で結果を確認し、
-- 問題なければ commit;、戻したければ rollback; とすること。
-- =============================================================

begin;

update public.votes
   set choice = case choice
                  when '協力できる' then '大賛成'
                  when '難しい'     then '賛成'
                  when 'わからない' then '無理'
                  when '保留'       then '無理'
                  else choice
                end
 where choice in ('協力できる', '難しい', 'わからない', '保留');

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
