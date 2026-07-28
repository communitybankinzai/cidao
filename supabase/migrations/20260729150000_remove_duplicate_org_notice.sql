-- 団体ページには「代表者の方による更新をお待ちしています」バナーが出るようになったため、
-- 説明文の中に同じ趣旨で入っている案内を削除する（同じことが2回表示されていた）。
--
-- 対象は2種類:
--  (a) WEB 公開情報から一括登録した 219 件（説明文の末尾に案内が付いている）
--  (b) 団体候補から仮登録した 14 件（説明文が案内そのもの → 空にする）

-- (b) 先に処理する。説明文が案内文だけなので、丸ごと消す。
update public.organizations
   set description = null
 where description like '%イベントの主催者名から作成した暫定の団体ページです%';

-- (a) 案内部分だけを取り除き、「参照分野: ○○」などは残す。
update public.organizations
   set description = replace(
         description,
         E'※ 印西市の市民活動団体に関する WEB 公開情報から取得した暫定データです。団体の代表者・役員の方は、CiDAOにログイン後「プロフィール編集 → 所属団体」からこの団体を追加し代表者申告をしてください。承認後、この団体ページを直接編集できるようになります。\n',
         ''
       )
 where description like '%代表者申告をしてください%';

-- 上の定型文以外の形で残っているものへの保険（案内文だけを行単位で除去）
update public.organizations
   set description = regexp_replace(
         description,
         E'※[^\n]*代表者申告をしてください[^\n]*\n?',
         '',
         'g'
       )
 where description like '%代表者申告をしてください%';

-- 案内を消した結果、空白だけになった説明文は空にする
update public.organizations
   set description = null
 where btrim(coalesce(description, '')) = '';
