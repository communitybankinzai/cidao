-- 団体の新規メンバー募集状況を表す enum と column を追加
-- open: 募集中（claim 済み団体が自己宣言）
-- closed: 募集停止中
-- invitation_only: 紹介・招待のみ
-- unknown: 状態不明（seed 投入時の初期値）

create type recruitment_status as enum ('open', 'closed', 'invitation_only', 'unknown');

alter table public.organizations
  add column recruitment_status recruitment_status not null default 'unknown';

-- match-orgs クエリでこの列を頻繁にフィルタするのでインデックス追加
create index idx_organizations_recruitment_status
  on public.organizations(recruitment_status)
  where recruitment_status in ('open', 'unknown');
