-- 団体データの出典表記から個人サイトのドメイン名を外し、「WEB 公開情報」という一般的な表現に置き換える。
-- 対象は団体ページに実際に表示されている organizations.description / activity_detail と、
-- プレースホルダーアカウントの自己紹介文。

update public.organizations
   set description = replace(
         description,
         '※ 印西市の市民活動団体登録情報を inzaiparque.com から抽出した暫定データです。',
         '※ 印西市の市民活動団体に関する WEB 公開情報から取得した暫定データです。'
       )
 where description like '%inzaiparque%';

-- 上の定型文以外の形で残っているものへの保険
update public.organizations
   set description = replace(description, 'inzaiparque.com', 'WEB 公開情報')
 where description like '%inzaiparque%';

update public.organizations
   set activity_detail = replace(activity_detail, 'inzaiparque.com', 'WEB 公開情報')
 where activity_detail like '%inzaiparque%';

update public.members
   set self_introduction =
         'システム生成のプレースホルダーアカウント。WEB 公開情報から取得したデータで作成された未認証団体の代表者欄を埋めるためのもの。各団体は代表者による本登録を待っている状態。'
 where id = '943a665e-474d-46da-9f2d-a8cfa0f1bcaa';
