-- 団体情報の自動拡充（Web/AI 由来）を保存する列を追加。
-- inzaiparque 由来の 220 件は description が 1 行＋免責テンプレで情報が薄いため、
-- 公式サイト・SNS・長文の活動説明・連絡先などを別列に provisional 保存する設計。
-- 表示は info_verified バッジで「自動収集・未確認」を明示し、
-- 代表者が claim/編集で確認したら info_verified=true に切り替える。

alter table public.organizations
  add column website_url       text,                              -- 公式サイト URL
  add column sns_links         jsonb not null default '{}'::jsonb, -- {x, facebook, instagram, youtube, line, ...}
  add column activity_detail   text,                              -- 長文の活動説明（既存 description より厚い）
  add column activity_area     text,                              -- 活動エリア（例: 印西市内中央部、千葉県北総地域）
  add column enriched_at       timestamptz,                       -- 最終拡充実行時刻（NULL=未拡充）
  add column enrichment_source jsonb not null default '[]'::jsonb,-- 出典URL配列 [{url, fetched_at, note}]
  add column info_verified     boolean not null default false;    -- 代表者が確認したか

comment on column public.organizations.website_url is        '公式サイトURL（拡充時に AI が候補から選定）';
comment on column public.organizations.sns_links is          'SNSリンク {x, facebook, instagram, youtube, line, ...}（拡充時に収集）';
comment on column public.organizations.activity_detail is    '長文の活動説明（拡充時に AI が複数ページを統合して生成。description より優先表示推奨）';
comment on column public.organizations.activity_area is      '活動エリア';
comment on column public.organizations.enriched_at is        '最終拡充実行時刻。NULL の場合は未拡充。';
comment on column public.organizations.enrichment_source is  '拡充時の出典URL配列 [{url, fetched_at, note}]';
comment on column public.organizations.info_verified is      '代表者が claim/編集で内容を確認したか（false=自動収集の暫定情報）';

-- 拡充スケジューラ用：未拡充から処理するためのインデックス
create index idx_organizations_enriched_at on public.organizations(enriched_at nulls first);
create index idx_organizations_info_verified on public.organizations(info_verified);
