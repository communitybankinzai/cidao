-- =============================================================
-- 電子決裁システム（CBI 役員の内部決裁）
--
-- 背景:
--   決裁規程（内規）案 v1（docs/2026-08-25_決裁規程_内規_案v1.md）に基づき、
--   役員会の決議を電磁的方法で行う仕組みをつくる。
--   設計方針: cidao/proposals/2026-08-25_電子決裁システムの設計方針.md
--
-- 方針:
--   1. members.officer_role で役員（会長/副会長/会計/監査役）を管理する。
--      既存の admin_role（システム管理権限）とは別軸。付与は管理者が手動で行う。
--   2. 決裁データは役員のみ閲覧可。anon には一切開放しない
--      （members と違い、決裁記録は公開情報ではない）。
--   3. 電子印（approval_stamps）は追記のみ。UPDATE/DELETE はトリガで拒否し、
--      押し直しは action='revoke' のレコードを積む。押印時刻はサーバー時刻。
--   4. 決裁基準（定足数・可決要件・期限・金額基準）は approval_rules に持たせ、
--      コードにハードコードしない。基準を変えるときは新しい version の行を足し、
--      旧行の valid_to を閉じる（過去の決裁の判定根拠が残る）。
--
-- ⚠ 初期データの数値は仮の値。決裁規程の【要決定】4箇所
--   （支出の基準額・可決要件・決裁期限・専決の報告期限）は役員会の議決後に
--   新 version の行で差し替えること。
--
-- ⚠ このファイルは Supabase SQL Editor でユーザーが手動適用する
--   （CLI 未認証のため。適用先: oxuxvtuhijnsewivgrje）。
-- =============================================================

-- ---------- 1. 役員区分（会長・副会長・会計・監査役）
do $$
begin
  if not exists (select 1 from pg_type where typname = 'officer_role') then
    create type public.officer_role as enum ('chair', 'vice_chair', 'treasurer', 'auditor');
  end if;
end $$;

-- NULL = 役員でない。付与は管理者が SQL / 管理画面から手動で行う（自己申告不可）
alter table public.members
  add column if not exists officer_role public.officer_role;

-- 役員かどうかのヘルパー（RLS から呼ぶ）
create or replace function public.is_officer()
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(
    (select officer_role is not null
       from public.members
      where id = auth.uid() and deleted_at is null),
    false
  );
$$;

-- ---------- 2. 決裁案件
create table if not exists public.approval_requests (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null check (char_length(title) between 1 and 100),
  -- 決裁区分（決裁規程 第3条）
  category             text not null check (category in
                         ('project', 'expense', 'document', 'conflict_of_interest')),
  body                 text not null check (char_length(body) between 1 and 10000),
  amount               integer check (amount is null or amount >= 0),  -- 支出区分のみ（円）
  requested_by         uuid not null references public.members(id) on delete restrict,
  status               text not null default 'pending' check (status in
                         ('draft', 'pending', 'approved', 'rejected', 'withdrawn')),
  -- 本文の SHA-256。スタンプ側にも押印時点のハッシュを持たせ、
  -- 本文が後から編集されたスタンプを無効として検知する
  body_hash            text not null,
  -- 利益相反区分: 当事者として指定された役員（起案者は常に当事者扱い）
  conflict_officer_ids uuid[] not null default '{}',
  conflict_note        text,  -- 利益相反の関係の内容（決裁規程 第6条第1項第五号）
  -- 添付ファイル [{ path, name, size }]（approval-attachments バケット内）
  attachments          jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  decided_at           timestamptz
);

create index if not exists idx_approval_requests_status
  on public.approval_requests (status, created_at desc);
create index if not exists idx_approval_requests_requester
  on public.approval_requests (requested_by);

-- ---------- 3. 電子印（追記のみ）
create table if not exists public.approval_stamps (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.approval_requests(id) on delete restrict,
  member_id    uuid not null references public.members(id) on delete restrict,
  officer_role public.officer_role not null,   -- 押印時点の役職を凍結
  action       text not null check (action in ('approve', 'reject', 'hold', 'revoke')),
  comment      text check (comment is null or char_length(comment) <= 1000),
  -- 押印時点の案件本文ハッシュ。approval_requests.body_hash と一致しない
  -- スタンプは「本文変更前の押印」として無効扱いにする
  body_hash    text not null,
  stamped_at   timestamptz not null default now()
);

create index if not exists idx_approval_stamps_request
  on public.approval_stamps (request_id, stamped_at);

-- 電子印は変更・削除不可（service_role も含めトリガで拒否）
create or replace function public.approval_stamps_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '電子印は変更・削除できません。押し直しは action=revoke のレコードを追記してください';
end;
$$;

drop trigger if exists trg_approval_stamps_block on public.approval_stamps;
create trigger trg_approval_stamps_block
  before update or delete on public.approval_stamps
  for each row execute function public.approval_stamps_block_mutation();

-- 押印時刻はサーバー時計で確定する（クライアント時刻・呼び出し側の指定を信用しない）
create or replace function public.approval_stamps_force_server_time()
returns trigger
language plpgsql
as $$
begin
  new.stamped_at := now();
  return new;
end;
$$;

drop trigger if exists trg_approval_stamps_time on public.approval_stamps;
create trigger trg_approval_stamps_time
  before insert on public.approval_stamps
  for each row execute function public.approval_stamps_force_server_time();

-- ---------- 4. 決裁基準（内規のデータ化。版を持つ）
create table if not exists public.approval_rules (
  id               uuid primary key default gen_random_uuid(),
  category         text not null check (category in
                     ('project', 'expense', 'document', 'conflict_of_interest')),
  label            text not null,          -- 画面表示名（例: 企画・事業の実施可否）
  description      text,                   -- 対象の説明（起案画面に表示）
  required_roles   text[] not null,        -- 承認が必須の役職（決裁権者）
  -- 決裁権者が起案者本人のときに代わりに決裁権者となる役職
  -- （決裁規程 第3条第1項第三号「起案者が会長である場合は副会長」）
  substitute_roles text[] not null default '{}',
  -- true: 当事者（起案者＋指定役員）を承認者から除外し、除外後の人数で
  -- 定足数を数え直す（決裁規程 第5条第3項）
  exclude_involved boolean not null default false,
  -- 定足数: 意思表示できる役員数 × quorum を「超える」意思表示で成立（過半数=0.5）
  quorum           numeric not null default 0.5 check (quorum >= 0 and quorum < 1),
  -- 可決要件: 意思表示した役員のうち承認が pass_fraction を「超えたら」可決（過半数=0.5）
  pass_fraction    numeric not null default 0.5 check (pass_fraction >= 0 and pass_fraction < 1),
  -- 支出区分のみ: この金額（円）以上の支出が決裁対象。null = 金額を問わず全件
  threshold_amount integer,
  deadline_days    integer not null default 7,  -- 決裁期限（決裁規程 第7条）
  version          integer not null default 1,
  valid_from       timestamptz not null default now(),
  valid_to         timestamptz,            -- null = 現行版
  created_at       timestamptz not null default now(),
  unique (category, version)
);

-- ---------- 5. RLS と GRANT
-- 既定権限（20260625160000）で anon に SELECT、authenticated に全操作が
-- 自動付与されるため、ここで明示的に締める。
-- anon: 一切不可 / authenticated: SELECT のみ（RLS で役員に限定）/
-- 書き込みはすべて Server Actions（service_role）経由で行う。
alter table public.approval_requests enable row level security;
alter table public.approval_stamps   enable row level security;
alter table public.approval_rules    enable row level security;

revoke all on table public.approval_requests from anon;
revoke all on table public.approval_stamps   from anon;
revoke all on table public.approval_rules    from anon;

revoke insert, update, delete on table public.approval_requests from authenticated;
revoke insert, update, delete on table public.approval_stamps   from authenticated;
revoke insert, update, delete on table public.approval_rules    from authenticated;

grant select on table public.approval_requests to authenticated;
grant select on table public.approval_stamps   to authenticated;
grant select on table public.approval_rules    to authenticated;

grant all on table public.approval_requests to service_role;
grant all on table public.approval_stamps   to service_role;
grant all on table public.approval_rules    to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'approval_requests'
       and policyname = 'approval_requests_select_officer'
  ) then
    create policy approval_requests_select_officer on public.approval_requests
      for select using (public.is_officer());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'approval_stamps'
       and policyname = 'approval_stamps_select_officer'
  ) then
    create policy approval_stamps_select_officer on public.approval_stamps
      for select using (public.is_officer());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'approval_rules'
       and policyname = 'approval_rules_select_officer'
  ) then
    create policy approval_rules_select_officer on public.approval_rules
      for select using (public.is_officer());
  end if;
  -- INSERT/UPDATE/DELETE のポリシーは意図的に作らない
  -- （書き込みは Server Actions の service_role 経由のみ。
  --   approval_stamps はさらにトリガで UPDATE/DELETE を全ロール拒否）
end $$;

-- ---------- 6. 添付ファイルの保存先（非公開バケット）
-- 既存の画像保存（event-flyers 等）は公開バケットだが、決裁文書には流用しない。
-- 閲覧は署名付き URL を役員にのみ発行する。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'approval-attachments',
  'approval-attachments',
  false,
  10485760, -- 10MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  -- 役員のみ閲覧・追加可。公開読み取りポリシーは作らない。
  -- 更新・削除ポリシーも作らない（決裁の証跡なので差し替え不可）
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'approval_attachments_officer_read'
  ) then
    create policy approval_attachments_officer_read on storage.objects
      for select to authenticated
      using (bucket_id = 'approval-attachments' and public.is_officer());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'approval_attachments_officer_upload'
  ) then
    create policy approval_attachments_officer_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'approval-attachments' and public.is_officer());
  end if;
end $$;

-- ---------- 7. 決裁基準の初期データ（決裁規程 案v1 第3条・第5条・第7条）
-- ⚠ 仮の値。役員会の議決後、新 version で差し替える（この行の valid_to を閉じる）。
-- 監査役（auditor）は required_roles に含めない（会計の監査を職務とするため、
-- 自ら承認すると監査の独立性が失われる。全件・全履歴の閲覧のみ）。
insert into public.approval_rules
  (category, label, description, required_roles, substitute_roles,
   exclude_involved, quorum, pass_fraction, threshold_amount, deadline_days, version)
values
  ('project', '企画・事業の実施可否',
   '本会の名において対外的に実施を表明する企画または事業',
   '{chair,vice_chair}', '{}',
   false, 0.5, 0.5, null, 7, 1),
  ('expense', '支出',
   '1件 10,000円以上の支出、および予算に計上のない支出（仮の基準額・役員会で決定）',
   '{treasurer,chair}', '{}',
   false, 0.5, 0.5, 10000, 7, 1),
  ('document', '対外文書の発信',
   '行政機関、企業その他の外部に提出する資料または本会名義の公式文書',
   '{chair}', '{vice_chair}',
   false, 0.5, 0.5, null, 7, 1),
  ('conflict_of_interest', '利益相反のある取引',
   '役員またはその関係者が取引の相手方となる取引（金額の多寡を問わず全件）',
   '{chair,vice_chair,treasurer}', '{}',
   true, 0.5, 0.5, null, 7, 1)
on conflict (category, version) do nothing;
