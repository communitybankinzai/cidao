-- 印西市市民活動推進条例 第2条の定義に準拠して organization_type を再設計。
--
-- 旧 enum: 'voluntary' | 'civic' | 'company' | 'government'
--   問題: 「任意団体 vs 市民活動団体」という対立軸を作っていたが、条例上は
--   両方とも「市民活動団体」（条例第2条第2号「市民活動団体 = 市民活動を行うことを
--   主たる目的とする団体。NPOなどの法人格の有無は問わない」）。
--   旧 'civic'/'voluntary' の実体は「印西市市民活動推進条例第10条登録の有無」だった。
--
-- 新 enum: 'civic_group' | 'business' | 'government'
--   civic_group  = 市民活動団体（法人格・市登録の有無は問わない、町内会・自治会も含む）
--   business     = 事業者（営利目的だが市民活動を行うもの。大学等も含む）
--   government   = 行政
--
-- 新規列 legal_form: 法人格を表すテキスト（NPO法人/一般社団/任意団体 等）。
--   名前の prefix から推定して backfill する。
-- 市登録の有無は inzai_registration_number IS NOT NULL で判定（既存仕様継続）。

-- 1. legal_form 列追加
alter table public.organizations
  add column legal_form text;

-- 2. legal_form を name のパターンから推定して backfill
update public.organizations
   set legal_form = case
     when name ~ '^(特定非営利活動法人|NPO法人)' then 'npo_corp'
     when name ~ '^一般社団法人' then 'general_incorporated_association'
     when name ~ '^一般財団法人' then 'general_incorporated_foundation'
     when name ~ '^公益社団法人' then 'public_interest_incorporated_association'
     when name ~ '^公益財団法人' then 'public_interest_incorporated_foundation'
     when name ~ '^社会福祉法人' then 'social_welfare_corporation'
     when name ~ '(自治会|町内会|区会)' then 'nintei_chien_dantai_or_unincorp'
     when name ~ '(株式会社|合同会社|有限会社)' then 'kabushiki_kaisha'
     else 'unincorporated'
   end
where legal_form is null;

-- 3. 新 enum 作成（一時名で）
create type organization_type_new as enum ('civic_group', 'business', 'government');

-- 4. ALTER COLUMN TYPE で旧→新値にマッピングしながら型変更
--    インデックス idx_organizations_type は ALTER COLUMN TYPE 時に自動再構築される
alter table public.organizations
  alter column type type organization_type_new
  using (
    case type::text
      when 'civic'      then 'civic_group'::organization_type_new
      when 'voluntary'  then 'civic_group'::organization_type_new
      when 'company'    then 'business'::organization_type_new
      when 'government' then 'government'::organization_type_new
    end
  );

-- 5. 旧 enum 削除して新を旧名にリネーム
drop type organization_type;
alter type organization_type_new rename to organization_type;

-- 6. ドキュメンテーション
comment on type public.organization_type is
  '印西市市民活動推進条例 第2条準拠の団体種別。'
  'civic_group: 市民活動団体（法人格・市登録の有無は問わない、町内会・自治会含む）。'
  'business: 事業者（営利目的だが市民活動を行うもの、大学等含む）。'
  'government: 行政。'
  '旧 voluntary/civic は両方とも civic_group に統合（条例上区別は無い）。'
  '旧 company は business にリネーム。';

comment on column public.organizations.type is
  '条例第2条の団体性質。市登録の有無は inzai_registration_number IS NOT NULL で別途判定する。';

comment on column public.organizations.legal_form is
  '法人格を表すテキスト。標準値: npo_corp / general_incorporated_association / '
  'general_incorporated_foundation / public_interest_incorporated_association / '
  'public_interest_incorporated_foundation / social_welfare_corporation / '
  'nintei_chien_dantai_or_unincorp / kabushiki_kaisha / unincorporated / other。'
  'enum にしていないのは将来の追加柔軟性のため。UI 側でラベル変換する。';

-- 7. 検索性向上：legal_form でフィルタする UI を想定して index 追加（軽量）
create index idx_organizations_legal_form on public.organizations(legal_form)
  where legal_form is not null;
